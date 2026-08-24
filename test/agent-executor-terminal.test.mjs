import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { HarnessAgentExecutor } from '../dist/agent-executor.js'

test('fails promptly when a turn ends before recording the automation prompt', async (t) => {
  const created = await mkdtemp(join(tmpdir(), 'dsh-automations-agent-terminal-'))
  const cwd = await realpath(created)
  t.after(() => rm(created, { recursive: true, force: true }))

  const listeners = new Set()
  const session = { seq: 0, events: [] }
  let provenanceRegistered = false
  let workspaceAttached = false
  let runAttached = false
  const agent = {
    session,
    async whenIdle() {},
    followup() {
      session.events.push(
        { seq: 0, type: 'turn/start' },
        {
          seq: 1,
          type: 'turn/end',
          data: {
            reason: {
              kind: 'error',
              error: { code: 'PRE_STEP_FAILED', message: 'pre-step failed' },
            },
          },
        },
      )
      session.seq = 2
    },
    cancel() {},
  }
  const ctx = {
    on(event, listener) {
      assert.equal(event, 'session/event')
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    agentDefaultModel: {
      currentSelection: () => ({ provider: 'test-provider', model: 'test-model' }),
    },
    agentPresets: {
      resolve: async () => ({ id: 'default' }),
    },
    permissionPresets: {
      resolve() {},
    },
    workspaceRegistry: {
      async resolveByPath() {
        return {
          async attachSession() {
            workspaceAttached = true
          },
        }
      },
    },
    agents: {
      create: async () => ({ agent, dispose: async () => {} }),
    },
    sessions: {
      async flush() {},
    },
  }
  agent.ctx = ctx
  const executor = new HarnessAgentExecutor(ctx, { authorize: async () => cwd })

  await assert.rejects(
    executor.execute({
      run: {
        snapshot: {
          task: { prompt: 'Prompt that cannot be recorded.' },
          execution: {
            cwd,
            permissionPreset: 'workspace-write',
            timeoutMs: 60_000,
          },
        },
      },
      signal: new AbortController().signal,
      registerSession: async () => {
        provenanceRegistered = true
      },
      attachSession: async () => {
        runAttached = true
      },
    }),
    { message: 'pre-step failed', code: 'PRE_STEP_FAILED' },
  )
  assert.equal(provenanceRegistered, true)
  assert.equal(workspaceAttached, false)
  assert.equal(runAttached, false)
  assert.equal(listeners.size, 0)
})
