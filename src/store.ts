import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { normalizeJobId, normalizeJobSpec } from './validation.js'
import { createEmptyState, isTerminalRunStatus } from './state.js'
import {
  STATE_SCHEMA_VERSION,
  type AutomationJob,
  type AutomationRun,
  type AutomationRunStatus,
  type AutomationState,
} from './types.js'

const RUN_STATUSES = new Set<AutomationRunStatus>([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'timed-out',
  'skipped',
  'interrupted',
])
const RUN_TRIGGERS = new Set(['cron', 'manual'])
const SKIP_REASONS = new Set(['overlap', 'misfire', 'job-disabled', 'job-deleted'])

export class AutomationStateError extends Error {
  readonly code = 'INVALID_AUTOMATION_STATE'

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AutomationStateError'
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AutomationStateError(`${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new AutomationStateError(`${path} must be ${allowEmpty ? 'a string' : 'a non-empty string'}`)
  }
  return value
}

function optionalText(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : text(value, path, true)
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new AutomationStateError(`${path} must be a positive safe integer`)
  }
  return value as number
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new AutomationStateError(`${path} must be a non-negative safe integer`)
  }
  return value as number
}

function instant(value: unknown, path: string): string {
  const result = text(value, path)
  if (!Number.isFinite(Date.parse(result))) throw new AutomationStateError(`${path} must be an ISO date-time`)
  return result
}

function optionalInstant(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : instant(value, path)
}

function decodeJob(value: unknown, key: string): AutomationJob {
  const input = record(value, `jobs.${key}`)
  const id = normalizeJobId(text(input.id, `jobs.${key}.id`))
  if (id !== key) throw new AutomationStateError(`jobs.${key}.id must equal its map key`)
  let spec
  try {
    spec = normalizeJobSpec({
      name: input.name,
      enabled: input.enabled,
      schedule: input.schedule,
      task: input.task,
      execution: input.execution,
      policies: input.policies,
    })
  } catch (cause) {
    throw new AutomationStateError(`jobs.${key} has an invalid definition`, { cause })
  }
  const nextRunAt = input.nextRunAt === null ? null : instant(input.nextRunAt, `jobs.${key}.nextRunAt`)
  return {
    ...spec,
    id,
    version: positiveInteger(input.version, `jobs.${key}.version`),
    createdAt: instant(input.createdAt, `jobs.${key}.createdAt`),
    updatedAt: instant(input.updatedAt, `jobs.${key}.updatedAt`),
    nextRunAt,
  }
}

function decodeRun(value: unknown, key: string): AutomationRun {
  const input = record(value, `runs.${key}`)
  const id = text(input.id, `runs.${key}.id`)
  if (id !== key) throw new AutomationStateError(`runs.${key}.id must equal its map key`)
  const status = text(input.status, `runs.${key}.status`) as AutomationRunStatus
  if (!RUN_STATUSES.has(status)) throw new AutomationStateError(`runs.${key}.status is unsupported`)
  const trigger = text(input.trigger, `runs.${key}.trigger`)
  if (!RUN_TRIGGERS.has(trigger)) throw new AutomationStateError(`runs.${key}.trigger is unsupported`)
  const snapshotInput = record(input.snapshot, `runs.${key}.snapshot`)
  let snapshot
  try {
    const spec = normalizeJobSpec({
      name: snapshotInput.name,
      enabled: snapshotInput.enabled,
      schedule: snapshotInput.schedule,
      task: snapshotInput.task,
      execution: snapshotInput.execution,
      policies: snapshotInput.policies,
    })
    snapshot = {
      ...spec,
      jobId: normalizeJobId(text(snapshotInput.jobId, `runs.${key}.snapshot.jobId`)),
      jobVersion: positiveInteger(snapshotInput.jobVersion, `runs.${key}.snapshot.jobVersion`),
    }
  } catch (cause) {
    throw new AutomationStateError(`runs.${key}.snapshot is invalid`, { cause })
  }
  const errorInput = input.error === undefined ? undefined : record(input.error, `runs.${key}.error`)
  const skipReason = input.skipReason === undefined ? undefined : text(input.skipReason, `runs.${key}.skipReason`)
  if (skipReason !== undefined && !SKIP_REASONS.has(skipReason)) {
    throw new AutomationStateError(`runs.${key}.skipReason is unsupported`)
  }
  return {
    id,
    occurrenceKey: text(input.occurrenceKey, `runs.${key}.occurrenceKey`),
    jobId: normalizeJobId(text(input.jobId, `runs.${key}.jobId`)),
    jobVersion: positiveInteger(input.jobVersion, `runs.${key}.jobVersion`),
    jobName: text(input.jobName, `runs.${key}.jobName`),
    trigger: trigger as AutomationRun['trigger'],
    scheduledFor: instant(input.scheduledFor, `runs.${key}.scheduledFor`),
    status,
    createdAt: instant(input.createdAt, `runs.${key}.createdAt`),
    ...(optionalInstant(input.startedAt, `runs.${key}.startedAt`) === undefined
      ? {}
      : { startedAt: optionalInstant(input.startedAt, `runs.${key}.startedAt`)! }),
    ...(optionalInstant(input.finishedAt, `runs.${key}.finishedAt`) === undefined
      ? {}
      : { finishedAt: optionalInstant(input.finishedAt, `runs.${key}.finishedAt`)! }),
    ...(optionalText(input.sessionId, `runs.${key}.sessionId`) === undefined
      ? {}
      : { sessionId: optionalText(input.sessionId, `runs.${key}.sessionId`)! }),
    ...(optionalText(input.output, `runs.${key}.output`) === undefined
      ? {}
      : { output: optionalText(input.output, `runs.${key}.output`)! }),
    ...(errorInput === undefined
      ? {}
      : {
          error: {
            code: text(errorInput.code, `runs.${key}.error.code`),
            message: text(errorInput.message, `runs.${key}.error.message`),
          },
        }),
    ...(skipReason === undefined
      ? {}
      : { skipReason: skipReason as NonNullable<AutomationRun['skipReason']> }),
    snapshot,
  }
}

export function decodeAutomationState(value: unknown): AutomationState {
  const input = record(value, 'state')
  if (input.schemaVersion !== STATE_SCHEMA_VERSION) {
    throw new AutomationStateError(
      `state.schemaVersion must be ${STATE_SCHEMA_VERSION}; found ${String(input.schemaVersion)}`,
    )
  }
  const jobsInput = record(input.jobs, 'state.jobs')
  const runsInput = record(input.runs, 'state.runs')
  const occurrencesInput = record(input.occurrences, 'state.occurrences')
  if (!Array.isArray(input.runOrder)) throw new AutomationStateError('state.runOrder must be an array')

  const jobs = Object.fromEntries(Object.entries(jobsInput).map(([key, job]) => [key, decodeJob(job, key)]))
  const runs = Object.fromEntries(Object.entries(runsInput).map(([key, run]) => [key, decodeRun(run, key)]))
  const runOrder = input.runOrder.map((id, index) => text(id, `state.runOrder[${index}]`))
  if (new Set(runOrder).size !== runOrder.length) throw new AutomationStateError('state.runOrder contains duplicate ids')
  if (runOrder.length !== Object.keys(runs).length || runOrder.some((id) => runs[id] === undefined)) {
    throw new AutomationStateError('state.runOrder must contain every run exactly once')
  }
  const occurrences: Record<string, string> = {}
  for (const [occurrenceKey, runIdValue] of Object.entries(occurrencesInput)) {
    const runId = text(runIdValue, `state.occurrences.${occurrenceKey}`)
    const run = runs[runId]
    if (run === undefined) throw new AutomationStateError(`state.occurrences.${occurrenceKey} points to a missing run`)
    if (run.occurrenceKey !== occurrenceKey) {
      throw new AutomationStateError(`state.occurrences.${occurrenceKey} does not match run ${runId}`)
    }
    occurrences[occurrenceKey] = runId
  }
  for (const run of Object.values(runs)) {
    if (occurrences[run.occurrenceKey] !== run.id) {
      throw new AutomationStateError(`run ${run.id} is missing from state.occurrences`)
    }
  }

  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    workspaceMembershipMigrationVersion: input.workspaceMembershipMigrationVersion === undefined
      ? 0
      : nonNegativeInteger(input.workspaceMembershipMigrationVersion, 'state.workspaceMembershipMigrationVersion'),
    revision: nonNegativeInteger(input.revision, 'state.revision'),
    jobs,
    runs,
    runOrder,
    occurrences,
  }
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

async function readStateFile(path: string): Promise<AutomationState> {
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (isEnoent(error)) return createEmptyState()
    throw error
  }
  if (text.trim() === '') return createEmptyState()
  try {
    return decodeAutomationState(JSON.parse(text))
  } catch (cause) {
    if (cause instanceof AutomationStateError) throw cause
    throw new AutomationStateError(`cannot parse automation state at ${path}`, { cause })
  }
}

function renderState(state: AutomationState): string {
  return `${JSON.stringify(state, null, 2)}\n`
}

export class AutomationStateStore {
  readonly path: string
  private readonly historyLimit: number
  private state: AutomationState = createEmptyState()
  private operations: Promise<void> = Promise.resolve()
  private closed = false

  constructor(path: string, historyLimit: number) {
    this.path = path
    this.historyLimit = historyLimit
  }

  async open(now: Date): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    await this.enqueue(async () => {
      await withFileLock(this.path, async () => {
        const state = await readStateFile(this.path)
        const timestamp = now.toISOString()
        for (const run of Object.values(state.runs)) {
          if (run.status !== 'running') continue
          run.status = 'interrupted'
          run.finishedAt = timestamp
          run.error = {
            code: 'HOST_RESTARTED',
            message: 'The Harness process stopped while this run was active; it was not retried automatically.',
          }
        }
        this.prune(state)
        state.revision += 1
        await writeFileAtomic(this.path, renderState(state), { mode: 0o600, dirMode: 0o700 })
        this.state = state
      })
    })
  }

  snapshot(): AutomationState {
    return structuredClone(this.state)
  }

  async mutate<T>(mutation: (state: AutomationState) => T | Promise<T>): Promise<T> {
    if (this.closed) throw new Error('automation state store is closed')
    let result!: T
    await this.enqueue(async () => {
      await withFileLock(this.path, async () => {
        const state = await readStateFile(this.path)
        result = await mutation(state)
        this.prune(state)
        state.revision += 1
        await writeFileAtomic(this.path, renderState(state), { mode: 0o600, dirMode: 0o700 })
        this.state = state
      })
    })
    return result
  }

  async close(): Promise<void> {
    this.closed = true
    await this.operations
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const current = this.operations.then(operation)
    this.operations = current.catch(() => undefined)
    return current
  }

  private prune(state: AutomationState): void {
    let terminalCount = state.runOrder.reduce((count, id) => {
      const run = state.runs[id]
      return count + (run !== undefined && isTerminalRunStatus(run.status) ? 1 : 0)
    }, 0)
    if (terminalCount <= this.historyLimit) return
    const retained: string[] = []
    for (const id of state.runOrder) {
      const run = state.runs[id]
      if (run === undefined) continue
      if (terminalCount > this.historyLimit && isTerminalRunStatus(run.status)) {
        terminalCount -= 1
        delete state.occurrences[run.occurrenceKey]
        delete state.runs[id]
        continue
      }
      retained.push(id)
    }
    state.runOrder = retained
  }
}
