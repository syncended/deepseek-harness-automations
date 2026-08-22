import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AutomationScheduler } from '../dist/scheduler.js'
import { AutomationStateStore } from '../dist/store.js'

const logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
}

function jobSpec(cwd, overrides = {}) {
  return {
    name: 'Scheduler test',
    enabled: false,
    schedule: { cron: '* * * * *', timezone: 'UTC' },
    task: { kind: 'agent', prompt: 'work' },
    execution: { cwd, permissionPreset: 'workspace-write', timeoutMs: 60_000 },
    policies: { overlap: 'skip', misfire: 'run-once' },
    ...overrides,
  }
}

async function eventually(read, predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = read()
    if (predicate(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail('condition was not reached before timeout')
}

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-automations-scheduler-'))
  const store = new AutomationStateStore(join(root, 'state.json'), 100)
  await store.open(options.now ?? new Date())
  const scheduler = new AutomationScheduler({
    store,
    maxConcurrentRuns: options.maxConcurrentRuns ?? 2,
    misfireGraceMs: 60_000,
    maxOutputChars: 10_000,
    logger,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  })
  t.after(async () => {
    await scheduler.stop()
    await store.close()
  })
  return { root, store, scheduler }
}

test('runs a manual occurrence through the registered executor', async (t) => {
  const { root, scheduler } = await fixture(t)
  scheduler.registerExecutor({
    kind: 'agent',
    async execute({ run, attachSession }) {
      await attachSession('session-test')
      return { sessionId: 'session-test', output: `done:${run.jobId}` }
    },
  })
  await scheduler.start()
  const job = await scheduler.create(jobSpec(root))
  const admitted = await scheduler.trigger(job.id)
  assert.equal(Object.hasOwn(admitted.snapshot, 'id'), false)
  assert.equal(Object.hasOwn(admitted.snapshot, 'nextRunAt'), false)
  const run = await eventually(
    () => scheduler.snapshot().runs.find((candidate) => candidate.id === admitted.id),
    (candidate) => candidate?.status === 'succeeded',
  )
  assert.equal(run.sessionId, 'session-test')
  assert.equal(run.output, `done:${job.id}`)
})

test('rejects invalid specs before they can poison durable state', async (t) => {
  const { root, scheduler } = await fixture(t)
  await scheduler.start()
  const invalid = jobSpec(root)
  invalid.execution.timeoutMs = 25
  await assert.rejects(() => scheduler.create(invalid), /between 1000 and 86400000/)
  assert.equal(scheduler.snapshot().jobs.length, 0)
  const valid = await scheduler.create(jobSpec(root))
  assert.equal(valid.id, 'scheduler-test')
})

test('stop interrupts a run admitted by an in-flight queue mutation', async (t) => {
  const { root, store, scheduler } = await fixture(t)
  let releaseMutation
  let markMutationEntered
  const mutationEntered = new Promise((resolve) => { markMutationEntered = resolve })
  const mutationGate = new Promise((resolve) => { releaseMutation = resolve })
  const originalMutate = store.mutate.bind(store)
  let blocked = false
  store.mutate = async (mutator) => {
    const hasQueuedRun = Object.values(store.snapshot().runs).some((run) => run.status === 'queued')
    if (!blocked && hasQueuedRun) {
      blocked = true
      markMutationEntered()
      await mutationGate
    }
    return originalMutate(mutator)
  }
  let executions = 0
  scheduler.registerExecutor({
    kind: 'agent',
    async execute() {
      executions += 1
      return { output: 'should not execute' }
    },
  })
  await scheduler.start()
  const job = await scheduler.create(jobSpec(root))
  const admitted = await scheduler.trigger(job.id)
  await mutationEntered
  const stopping = scheduler.stop()
  releaseMutation()
  await stopping
  const run = scheduler.snapshot().runs.find((candidate) => candidate.id === admitted.id)
  assert.equal(executions, 0)
  assert.equal(run.status, 'interrupted')
  assert.equal(run.error.code, 'HOST_STOPPING')
})

test('skip overlap policy records a skipped second trigger', async (t) => {
  const { root, scheduler } = await fixture(t, { maxConcurrentRuns: 2 })
  let release
  scheduler.registerExecutor({
    kind: 'agent',
    execute() {
      return new Promise((resolve) => {
        release = () => resolve({ output: 'released' })
      })
    },
  })
  await scheduler.start()
  const job = await scheduler.create(jobSpec(root))
  const first = await scheduler.trigger(job.id)
  await eventually(
    () => scheduler.snapshot().runs.find((run) => run.id === first.id),
    (run) => run?.status === 'running',
  )
  const second = await scheduler.trigger(job.id)
  assert.equal(second.status, 'skipped')
  assert.equal(second.skipReason, 'overlap')
  release()
  await eventually(
    () => scheduler.snapshot().runs.find((run) => run.id === first.id),
    (run) => run?.status === 'succeeded',
  )
})

test('queue overlap policy serializes runs for one job', async (t) => {
  const { root, scheduler } = await fixture(t, { maxConcurrentRuns: 2 })
  const releases = []
  scheduler.registerExecutor({
    kind: 'agent',
    execute({ run }) {
      return new Promise((resolve) => {
        releases.push(() => resolve({ output: run.id }))
      })
    },
  })
  await scheduler.start()
  const job = await scheduler.create(jobSpec(root, {
    policies: { overlap: 'queue', misfire: 'run-once' },
  }))
  const first = await scheduler.trigger(job.id)
  const second = await scheduler.trigger(job.id)
  await eventually(
    () => scheduler.snapshot().runs,
    (runs) => runs.find((run) => run.id === first.id)?.status === 'running'
      && runs.find((run) => run.id === second.id)?.status === 'queued',
  )
  await eventually(() => releases.length, (count) => count === 1)
  releases.shift()()
  await eventually(
    () => scheduler.snapshot().runs.find((run) => run.id === second.id),
    (run) => run?.status === 'running',
  )
  await eventually(() => releases.length, (count) => count === 1)
  releases.shift()()
  await eventually(
    () => scheduler.snapshot().runs.find((run) => run.id === second.id),
    (run) => run?.status === 'succeeded',
  )
})

test('cancels a running executor through its abort signal', async (t) => {
  const { root, scheduler } = await fixture(t)
  scheduler.registerExecutor({
    kind: 'agent',
    execute({ signal }) {
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    },
  })
  await scheduler.start()
  const job = await scheduler.create(jobSpec(root))
  const admitted = await scheduler.trigger(job.id)
  await eventually(
    () => scheduler.snapshot().runs.find((run) => run.id === admitted.id),
    (run) => run?.status === 'running',
  )
  await scheduler.cancel(admitted.id, 'test cancellation')
  const run = await eventually(
    () => scheduler.snapshot().runs.find((candidate) => candidate.id === admitted.id),
    (candidate) => candidate?.status === 'cancelled',
  )
  assert.equal(run.error.code, 'RUN_CANCELLED')
})

test('marks a cooperative executor timed-out at the configured wall-clock limit', async (t) => {
  const { root, scheduler } = await fixture(t)
  scheduler.registerExecutor({
    kind: 'agent',
    execute({ signal }) {
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    },
  })
  await scheduler.start()
  const configured = jobSpec(root)
  configured.execution.timeoutMs = 1_000
  const job = await scheduler.create(configured)
  const admitted = await scheduler.trigger(job.id)
  const run = await eventually(
    () => scheduler.snapshot().runs.find((candidate) => candidate.id === admitted.id),
    (candidate) => candidate?.status === 'timed-out',
  )
  assert.equal(run.error.code, 'RUN_TIMEOUT')
})

class FakeClock {
  constructor(now) {
    this.time = now.getTime()
    this.nextId = 1
    this.timers = new Map()
  }
  now() { return new Date(this.time) }
  setTimeout(callback, delayMs) {
    const id = this.nextId++
    this.timers.set(id, { at: this.time + delayMs, callback })
    return id
  }
  clearTimeout(id) { this.timers.delete(id) }
  async advance(ms) {
    const target = this.time + ms
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0]
      if (!due) break
      this.time = due[1].at
      this.timers.delete(due[0])
      due[1].callback()
      await new Promise((resolve) => setImmediate(resolve))
    }
    this.time = target
    await new Promise((resolve) => setImmediate(resolve))
  }
}

test('admits an enabled cron occurrence when the durable watermark becomes due', async (t) => {
  const clock = new FakeClock(new Date('2026-01-01T00:00:30.000Z'))
  const { root, scheduler } = await fixture(t, { clock, now: clock.now() })
  scheduler.registerExecutor({ kind: 'agent', async execute() { return { output: 'cron done' } } })
  await scheduler.start()
  const job = await scheduler.create(jobSpec(root, { enabled: true }))
  assert.equal(job.nextRunAt, '2026-01-01T00:01:00.000Z')
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  await clock.advance(30_001)
  const run = await eventually(
    () => scheduler.snapshot().runs.find((candidate) => candidate.jobId === job.id),
    (candidate) => candidate?.status === 'succeeded',
  )
  assert.equal(run.trigger, 'cron')
  assert.equal(run.scheduledFor, '2026-01-01T00:01:00.000Z')
})
