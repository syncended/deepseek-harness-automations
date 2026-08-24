import { randomUUID } from 'node:crypto'
import { latestCronOccurrence, nextCronOccurrence } from './cron.js'
import {
  activeRunsForJob,
  isTerminalRunStatus,
  orderedJobs,
  orderedRuns,
  registerAutomationSession,
} from './state.js'
import { AutomationStateStore } from './store.js'
import {
  AutomationInputError,
  normalizeJobId,
  normalizeJobSpec,
  slugifyJobId,
} from './validation.js'
import type {
  AutomationExecutor,
  AutomationJob,
  AutomationJobSpec,
  AutomationRun,
  AutomationRunError,
  AutomationRunSnapshot,
  AutomationRunStatus,
  AutomationSnapshot,
  SchedulerClock,
} from './types.js'

const MAX_TIMER_DELAY_MS = 2_147_483_647
const RETRY_AFTER_DRIVE_ERROR_MS = 5_000

const SYSTEM_CLOCK: SchedulerClock = {
  now: () => new Date(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
}

interface SchedulerLogger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

interface SchedulerOptions {
  store: AutomationStateStore
  maxConcurrentRuns: number
  misfireGraceMs: number
  maxOutputChars: number
  logger: SchedulerLogger
  clock?: SchedulerClock
}

type AbortKind = 'cancelled' | 'timed-out' | 'interrupted'

class AutomationAbortError extends Error {
  readonly kind: AbortKind

  constructor(kind: AbortKind, message: string) {
    super(message)
    this.name = 'AutomationAbortError'
    this.kind = kind
  }
}

interface ActiveRun {
  controller: AbortController
  promise: Promise<void>
}

function conflict(message: string): never {
  throw new AutomationInputError(message, 'VERSION_CONFLICT', 409)
}

function notFound(entity: string, id: string): never {
  throw new AutomationInputError(`${entity} "${id}" was not found`, 'NOT_FOUND', 404)
}

function cloneSpec(spec: AutomationJobSpec): AutomationJobSpec {
  return structuredClone({
    name: spec.name,
    enabled: spec.enabled,
    schedule: spec.schedule,
    task: spec.task,
    execution: spec.execution,
    policies: spec.policies,
  })
}

function snapshotOf(job: AutomationJob): AutomationRunSnapshot {
  return {
    ...cloneSpec(job),
    jobId: job.id,
    jobVersion: job.version,
  }
}

function runError(error: unknown): AutomationRunError {
  if (error instanceof AutomationAbortError) {
    return {
      code: error.kind === 'timed-out' ? 'RUN_TIMEOUT' : error.kind === 'interrupted' ? 'HOST_STOPPING' : 'RUN_CANCELLED',
      message: error.message,
    }
  }
  return {
    code:
      typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'EXECUTION_FAILED',
    message: error instanceof Error ? error.message : String(error),
  }
}

function terminalStatus(error: unknown): AutomationRunStatus {
  if (!(error instanceof AutomationAbortError)) return 'failed'
  return error.kind
}

function boundedOutput(value: string | undefined, maxChars: number): string | undefined {
  if (value === undefined) return undefined
  if (value.length <= maxChars) return value
  return `${value.slice(0, Math.max(0, maxChars - 26))}\n…[output truncated]`
}

export class AutomationScheduler {
  private readonly store: AutomationStateStore
  private readonly maxConcurrentRuns: number
  private readonly misfireGraceMs: number
  private readonly maxOutputChars: number
  private readonly logger: SchedulerLogger
  private readonly clock: SchedulerClock
  private readonly executors = new Map<string, AutomationExecutor>()
  private readonly active = new Map<string, ActiveRun>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private drivePromise: Promise<void> | undefined
  private driveRequested = false
  private started = false
  private stopping = false

  constructor(options: SchedulerOptions) {
    this.store = options.store
    this.maxConcurrentRuns = options.maxConcurrentRuns
    this.misfireGraceMs = options.misfireGraceMs
    this.maxOutputChars = options.maxOutputChars
    this.logger = options.logger
    this.clock = options.clock ?? SYSTEM_CLOCK
  }

  registerExecutor(executor: AutomationExecutor): () => void {
    const kind = executor.kind.trim()
    if (kind === '') throw new Error('automation executor kind must not be empty')
    if (this.executors.has(kind)) throw new Error(`automation executor "${kind}" is already registered`)
    this.executors.set(kind, executor)
    this.requestDrive()
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      if (this.executors.get(kind) === executor) this.executors.delete(kind)
    }
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    this.stopping = false
    await this.reconcileJobs()
    this.requestDrive()
  }

  async stop(): Promise<void> {
    if (this.stopping) return
    this.stopping = true
    this.started = false
    this.clearTimer()
    for (const active of this.active.values()) {
      if (!active.controller.signal.aborted) {
        active.controller.abort(new AutomationAbortError('interrupted', 'The Harness automation service is stopping.'))
      }
    }
    await this.drivePromise?.catch(() => undefined)
    await Promise.allSettled([...this.active.values()].map((entry) => entry.promise))
  }

  snapshot(limit = 100): AutomationSnapshot {
    const state = this.store.snapshot()
    return {
      revision: state.revision,
      jobs: orderedJobs(state),
      runs: orderedRuns(state, limit),
      automationSessionIds: [...state.automationSessionIds],
      automationSessionsRevision: state.automationSessionsRevision,
    }
  }

  async create(spec: AutomationJobSpec, requestedId?: string): Promise<AutomationJob> {
    const normalized = normalizeJobSpec(spec)
    const now = this.clock.now()
    const job = await this.store.mutate((state) => {
      let id = requestedId === undefined
        ? this.allocateJobId(state.jobs, normalized.name)
        : normalizeJobId(requestedId)
      if (state.jobs[id] !== undefined) {
        if (requestedId !== undefined) throw new AutomationInputError(`job "${id}" already exists`, 'ALREADY_EXISTS', 409)
        id = this.allocateJobId(state.jobs, normalized.name)
      }
      const timestamp = now.toISOString()
      const created: AutomationJob = {
        ...cloneSpec(normalized),
        id,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        nextRunAt: normalized.enabled
          ? nextCronOccurrence(normalized.schedule.cron, normalized.schedule.timezone, now).toISOString()
          : null,
      }
      state.jobs[id] = created
      return structuredClone(created)
    })
    this.requestDrive()
    return job
  }

  async update(idValue: string, spec: AutomationJobSpec, expectedVersion?: number): Promise<AutomationJob> {
    const id = normalizeJobId(idValue)
    const normalized = normalizeJobSpec(spec)
    const now = this.clock.now()
    const job = await this.store.mutate((state) => {
      const current = state.jobs[id]
      if (current === undefined) notFound('job', id)
      if (expectedVersion !== undefined && current.version !== expectedVersion) {
        conflict(`job "${id}" changed: expected version ${expectedVersion}, current version ${current.version}`)
      }
      const updated: AutomationJob = {
        ...cloneSpec(normalized),
        id,
        version: current.version + 1,
        createdAt: current.createdAt,
        updatedAt: now.toISOString(),
        nextRunAt: normalized.enabled
          ? nextCronOccurrence(normalized.schedule.cron, normalized.schedule.timezone, now).toISOString()
          : null,
      }
      state.jobs[id] = updated
      return structuredClone(updated)
    })
    this.requestDrive()
    return job
  }

  async setEnabled(idValue: string, enabled: boolean, expectedVersion?: number): Promise<AutomationJob> {
    const id = normalizeJobId(idValue)
    const current = this.store.snapshot().jobs[id]
    if (current === undefined) notFound('job', id)
    return this.update(id, { ...cloneSpec(current), enabled }, expectedVersion)
  }

  async remove(idValue: string): Promise<void> {
    const id = normalizeJobId(idValue)
    const now = this.clock.now().toISOString()
    await this.store.mutate((state) => {
      if (state.jobs[id] === undefined) notFound('job', id)
      delete state.jobs[id]
      for (const run of Object.values(state.runs)) {
        if (run.jobId !== id || run.status !== 'queued') continue
        run.status = 'skipped'
        run.skipReason = 'job-deleted'
        run.finishedAt = now
      }
    })
    this.requestDrive()
  }

  async trigger(idValue: string): Promise<AutomationRun> {
    const id = normalizeJobId(idValue)
    const now = this.clock.now()
    const run = await this.store.mutate((state) => {
      const job = state.jobs[id]
      if (job === undefined) notFound('job', id)
      return structuredClone(this.admitRun(state, job, 'manual', now, `manual:${randomUUID()}`))
    })
    this.requestDrive()
    return run
  }

  async cancel(runId: string, reason = 'Cancelled by the user.'): Promise<AutomationRun> {
    const now = this.clock.now().toISOString()
    const run = await this.store.mutate((state) => {
      const current = state.runs[runId]
      if (current === undefined) notFound('run', runId)
      if (current.status === 'queued' || current.status === 'running') {
        current.status = 'cancelled'
        current.finishedAt = now
        current.error = { code: 'RUN_CANCELLED', message: reason }
      }
      return structuredClone(current)
    })
    const active = this.active.get(runId)
    if (active !== undefined && !active.controller.signal.aborted) {
      active.controller.abort(new AutomationAbortError('cancelled', reason))
    }
    this.requestDrive()
    return run
  }

  private allocateJobId(jobs: Record<string, AutomationJob>, name: string): string {
    const base = slugifyJobId(name)
    if (jobs[base] === undefined) return base
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = `${base.slice(0, 54)}-${randomUUID().slice(0, 8)}`
      if (jobs[id] === undefined) return id
    }
    throw new Error('could not allocate a unique automation job id')
  }

  private async reconcileJobs(): Promise<void> {
    const now = this.clock.now()
    await this.store.mutate((state) => {
      for (const job of Object.values(state.jobs)) {
        if (!job.enabled) {
          job.nextRunAt = null
          continue
        }
        if (job.nextRunAt === null || !Number.isFinite(Date.parse(job.nextRunAt))) {
          job.nextRunAt = nextCronOccurrence(job.schedule.cron, job.schedule.timezone, now).toISOString()
        }
      }
      for (const run of Object.values(state.runs)) {
        if (run.status !== 'queued') continue
        if (state.jobs[run.jobId] !== undefined) continue
        run.status = 'skipped'
        run.skipReason = 'job-deleted'
        run.finishedAt = now.toISOString()
      }
    })
  }

  private requestDrive(): void {
    if (!this.started || this.stopping) return
    this.driveRequested = true
    if (this.drivePromise !== undefined) return
    this.drivePromise = this.driveLoop().finally(() => {
      this.drivePromise = undefined
      if (this.driveRequested && this.started && !this.stopping) this.requestDrive()
    })
  }

  private async driveLoop(): Promise<void> {
    while (this.driveRequested && this.started && !this.stopping) {
      this.driveRequested = false
      this.clearTimer()
      try {
        await this.claimDueRuns()
        await this.drainQueue()
        this.armNext()
      } catch (error) {
        this.logger.error('automations: scheduler drive failed')
        this.logger.error(error instanceof Error ? error.stack ?? error.message : String(error))
        this.arm(RETRY_AFTER_DRIVE_ERROR_MS)
      }
    }
  }

  private async claimDueRuns(): Promise<void> {
    const now = this.clock.now()
    const due = orderedJobs(this.store.snapshot()).filter(
      (job) => job.enabled && job.nextRunAt !== null && Date.parse(job.nextRunAt) <= now.getTime(),
    )
    for (const candidate of due) await this.claimDueRun(candidate.id, now)
  }

  private async claimDueRun(jobId: string, now: Date): Promise<AutomationRun | undefined> {
    return this.store.mutate((state) => {
      const job = state.jobs[jobId]
      if (job === undefined || !job.enabled || job.nextRunAt === null) return undefined
      const dueAt = new Date(job.nextRunAt)
      if (dueAt.getTime() > now.getTime()) return undefined

      const lateBy = now.getTime() - dueAt.getTime()
      const misfired = lateBy > this.misfireGraceMs
      const scheduledFor =
        misfired && job.policies.misfire === 'run-once'
          ? latestCronOccurrence(job.schedule.cron, job.schedule.timezone, now)
          : dueAt
      job.nextRunAt = nextCronOccurrence(job.schedule.cron, job.schedule.timezone, now).toISOString()
      const occurrenceKey = `${job.id}:cron:${scheduledFor.toISOString()}`
      const existingId = state.occurrences[occurrenceKey]
      if (existingId !== undefined) return state.runs[existingId]

      if (misfired && job.policies.misfire === 'skip') {
        return this.admitSkippedRun(state, job, scheduledFor, occurrenceKey, 'misfire')
      }
      return this.admitRun(state, job, 'cron', scheduledFor, occurrenceKey)
    })
  }

  private admitRun(
    state: ReturnType<AutomationStateStore['snapshot']>,
    job: AutomationJob,
    trigger: AutomationRun['trigger'],
    scheduledFor: Date,
    occurrenceKey: string,
  ): AutomationRun {
    if (job.policies.overlap === 'skip' && activeRunsForJob(state, job.id).length > 0) {
      return this.admitSkippedRun(state, job, scheduledFor, occurrenceKey, 'overlap', trigger)
    }
    const timestamp = this.clock.now().toISOString()
    const run: AutomationRun = {
      id: `run-${randomUUID()}`,
      occurrenceKey,
      jobId: job.id,
      jobVersion: job.version,
      jobName: job.name,
      trigger,
      scheduledFor: scheduledFor.toISOString(),
      status: 'queued',
      createdAt: timestamp,
      snapshot: snapshotOf(job),
    }
    state.runs[run.id] = run
    state.runOrder.push(run.id)
    state.occurrences[occurrenceKey] = run.id
    return run
  }

  private admitSkippedRun(
    state: ReturnType<AutomationStateStore['snapshot']>,
    job: AutomationJob,
    scheduledFor: Date,
    occurrenceKey: string,
    reason: NonNullable<AutomationRun['skipReason']>,
    trigger: AutomationRun['trigger'] = 'cron',
  ): AutomationRun {
    const timestamp = this.clock.now().toISOString()
    const run: AutomationRun = {
      id: `run-${randomUUID()}`,
      occurrenceKey,
      jobId: job.id,
      jobVersion: job.version,
      jobName: job.name,
      trigger,
      scheduledFor: scheduledFor.toISOString(),
      status: 'skipped',
      createdAt: timestamp,
      finishedAt: timestamp,
      skipReason: reason,
      snapshot: snapshotOf(job),
    }
    state.runs[run.id] = run
    state.runOrder.push(run.id)
    state.occurrences[occurrenceKey] = run.id
    return run
  }

  private async drainQueue(): Promise<void> {
    while (this.active.size < this.maxConcurrentRuns && this.started && !this.stopping) {
      const state = this.store.snapshot()
      const queued = state.runOrder
        .map((id) => state.runs[id])
        .filter((run): run is AutomationRun => run?.status === 'queued')
      const next = queued.find((run) => {
        if (run.snapshot.policies.overlap === 'allow') return true
        return ![...this.active.keys()].some((id) => state.runs[id]?.jobId === run.jobId)
      })
      if (next === undefined) return
      const executor = this.executors.get(next.snapshot.task.kind)
      if (executor === undefined) {
        await this.finishRun(next.id, 'failed', {
          code: 'EXECUTOR_NOT_REGISTERED',
          message: `No automation executor is registered for task kind "${next.snapshot.task.kind}".`,
        })
        continue
      }
      const started = await this.store.mutate((latest) => {
        const run = latest.runs[next.id]
        if (run === undefined || run.status !== 'queued') return undefined
        run.status = 'running'
        run.startedAt = this.clock.now().toISOString()
        return structuredClone(run)
      })
      if (started === undefined) continue
      if (this.stopping || !this.started) {
        await this.finishRun(started.id, 'interrupted', {
          code: 'HOST_STOPPING',
          message: 'The Harness automation service stopped before execution began.',
        })
        return
      }
      if (this.store.snapshot().runs[started.id]?.status !== 'running') continue
      const controller = new AbortController()
      // Publish cancellation ownership before invoking third-party executor code.
      const promise = Promise.resolve()
        .then(async () => this.executeRun(started, executor, controller))
        .finally(() => {
          this.active.delete(started.id)
          this.requestDrive()
        })
      this.active.set(started.id, { controller, promise })
    }
  }

  private async executeRun(
    run: AutomationRun,
    executor: AutomationExecutor,
    controller: AbortController,
  ): Promise<void> {
    const timeout = this.clock.setTimeout(() => {
      if (!controller.signal.aborted) {
        controller.abort(
          new AutomationAbortError('timed-out', `Run exceeded its ${run.snapshot.execution.timeoutMs} ms timeout.`),
        )
      }
    }, run.snapshot.execution.timeoutMs)
    try {
      const result = await executor.execute({
        run,
        signal: controller.signal,
        registerSession: async (sessionId) => {
          await this.store.mutate((state) => {
            registerAutomationSession(state, sessionId)
          })
        },
        attachSession: async (sessionId) => {
          await this.store.mutate((state) => {
            const current = state.runs[run.id]
            if (current === undefined || current.status !== 'running') return
            current.sessionId = sessionId
            registerAutomationSession(state, sessionId)
          })
        },
      })
      if (controller.signal.aborted) throw controller.signal.reason
      await this.store.mutate((state) => {
        const current = state.runs[run.id]
        if (current === undefined || current.status !== 'running') return
        current.status = 'succeeded'
        current.finishedAt = this.clock.now().toISOString()
        if (result.sessionId !== undefined) {
          current.sessionId = result.sessionId
          registerAutomationSession(state, result.sessionId)
        }
        const output = boundedOutput(result.output, this.maxOutputChars)
        if (output !== undefined) current.output = output
      })
    } catch (error) {
      const normalized = error instanceof AutomationAbortError ? error : controller.signal.aborted ? controller.signal.reason : error
      await this.finishRun(run.id, terminalStatus(normalized), runError(normalized))
    } finally {
      this.clock.clearTimeout(timeout)
    }
  }

  private async finishRun(runId: string, status: AutomationRunStatus, error: AutomationRunError): Promise<void> {
    await this.store.mutate((state) => {
      const current = state.runs[runId]
      if (current === undefined || isTerminalRunStatus(current.status)) return
      current.status = status
      current.finishedAt = this.clock.now().toISOString()
      current.error = error
    })
  }

  private armNext(): void {
    const now = this.clock.now().getTime()
    let delay: number | undefined
    for (const job of Object.values(this.store.snapshot().jobs)) {
      if (!job.enabled || job.nextRunAt === null) continue
      const candidate = Math.max(0, Date.parse(job.nextRunAt) - now)
      delay = delay === undefined ? candidate : Math.min(delay, candidate)
    }
    if (delay !== undefined) this.arm(delay)
  }

  private arm(delayMs: number): void {
    if (!this.started || this.stopping) return
    this.clearTimer()
    const bounded = Math.max(1, Math.min(MAX_TIMER_DELAY_MS, delayMs))
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined
      this.requestDrive()
    }, bounded)
  }

  private clearTimer(): void {
    if (this.timer === undefined) return
    this.clock.clearTimeout(this.timer)
    this.timer = undefined
  }
}
