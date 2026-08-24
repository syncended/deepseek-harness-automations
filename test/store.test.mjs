import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AutomationStateStore, decodeAutomationState } from '../dist/store.js'

test('defaults the workspace migration marker in pre-0.8.3 state', () => {
  const state = decodeAutomationState({
    schemaVersion: 1,
    revision: 0,
    jobs: {},
    runs: {},
    runOrder: [],
    occurrences: {},
  })
  assert.equal(state.workspaceMembershipMigrationVersion, 0)
  assert.deepEqual(state.automationSessionIds, [])
  assert.equal(state.automationSessionsRevision, 0)
})

function spec(cwd) {
  return {
    name: 'Store test',
    enabled: false,
    schedule: { cron: '0 9 * * *', timezone: 'UTC' },
    task: { kind: 'agent', prompt: 'test' },
    execution: { cwd, permissionPreset: 'workspace-write', timeoutMs: 60_000 },
    policies: { overlap: 'skip', misfire: 'run-once' },
  }
}

test('atomically persists private state and marks crash-orphaned runs interrupted', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-automations-store-'))
  const path = join(root, 'private', 'state.json')
  const openedAt = new Date('2026-01-01T00:00:00.000Z')
  const store = new AutomationStateStore(path, 100)
  await store.open(openedAt)
  await store.mutate((state) => {
    const jobSpec = spec(root)
    state.jobs.test = {
      ...jobSpec,
      id: 'test',
      version: 1,
      createdAt: openedAt.toISOString(),
      updatedAt: openedAt.toISOString(),
      nextRunAt: null,
    }
    const run = {
      id: 'run-test',
      occurrenceKey: 'manual:test',
      jobId: 'test',
      jobVersion: 1,
      jobName: 'Store test',
      trigger: 'manual',
      scheduledFor: openedAt.toISOString(),
      status: 'running',
      createdAt: openedAt.toISOString(),
      startedAt: openedAt.toISOString(),
      snapshot: { ...jobSpec, jobId: 'test', jobVersion: 1 },
    }
    state.runs[run.id] = run
    state.runOrder.push(run.id)
    state.occurrences[run.occurrenceKey] = run.id
  })
  await store.close()

  const mode = (await stat(path)).mode & 0o777
  assert.equal(mode, 0o600)
  const persisted = await readFile(path, 'utf8')
  assert.doesNotThrow(() => JSON.parse(persisted))

  const restored = new AutomationStateStore(path, 100)
  await restored.open(new Date('2026-01-01T01:00:00.000Z'))
  const run = restored.snapshot().runs['run-test']
  assert.equal(run.status, 'interrupted')
  assert.equal(run.error.code, 'HOST_RESTARTED')
  assert.equal(run.finishedAt, '2026-01-01T01:00:00.000Z')
  await restored.close()
})

test('retains active runs while pruning oldest terminal history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-automations-prune-'))
  const path = join(root, 'state.json')
  const store = new AutomationStateStore(path, 10)
  await store.open(new Date())
  await store.mutate((state) => {
    state.automationSessionIds.push('session-from-pruned-run')
    state.automationSessionsRevision = 1
    const now = new Date().toISOString()
    const jobSpec = spec(root)
    for (let index = 0; index < 12; index += 1) {
      const id = `run-${index}`
      const occurrenceKey = `manual:${index}`
      state.runs[id] = {
        id,
        occurrenceKey,
        jobId: 'test',
        jobVersion: 1,
        jobName: 'Store test',
        trigger: 'manual',
        scheduledFor: now,
        status: index === 0 ? 'queued' : 'succeeded',
        createdAt: now,
        ...(index === 0 ? {} : { finishedAt: now }),
        snapshot: { ...jobSpec, jobId: 'test', jobVersion: 1 },
      }
      state.runOrder.push(id)
      state.occurrences[occurrenceKey] = id
    }
  })
  const state = store.snapshot()
  assert.ok(state.runs['run-0'])
  assert.equal(Object.values(state.runs).filter((run) => run.status === 'succeeded').length, 10)
  assert.equal(state.runs['run-1'], undefined)
  assert.deepEqual(state.automationSessionIds, ['session-from-pruned-run'])
  assert.equal(state.automationSessionsRevision, 1)
  await store.close()
})
