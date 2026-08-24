import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { HarnessAgentExecutor } from '../dist/agent-executor.js'

test('records a visible prompt and attaches the session to its DSH workspace', async (t) => {
  const created = await mkdtemp(join(tmpdir(), 'dsh-automations-agent-'))
  const cwd = await realpath(created)
  t.after(() => rm(created, { recursive: true, force: true }))

  let submitted
  let persistedEvents = []
  let resolvedWorkspacePath
  const workspaceSessions = []
  const attachmentOrder = []
  const sessionEventListeners = new Set()
  let promptFlushed = false
  const session = { seq: 0, events: [] }
  const agent = {
    session,
    async whenIdle() {},
    followup(message) {
      submitted = message
      session.events.push(
        { seq: 0, type: 'user/message', data: message },
        { seq: 1, type: 'turn/start' },
        {
          seq: 2,
          type: 'assistant/message',
          data: { message: { content: [{ type: 'text', text: 'done' }] } },
        },
        { seq: 3, type: 'turn/end', data: { reason: { kind: 'completed' } } },
      )
      session.seq = 4
      attachmentOrder.push('prompt')
      for (const listener of sessionEventListeners) listener(session, session.events[0])
    },
    cancel() {},
  }
  const ctx = {
    on(event, listener) {
      assert.equal(event, 'session/event')
      sessionEventListeners.add(listener)
      return () => sessionEventListeners.delete(listener)
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
      async resolveByPath(path) {
        resolvedWorkspacePath = path
        return {
          async attachSession(sessionId) {
            workspaceSessions.push(sessionId)
            attachmentOrder.push('workspace')
          },
        }
      },
    },
    agents: {
      create: async () => ({ agent, dispose: async () => {} }),
    },
    sessions: {
      flush: async (flushed) => {
        persistedEvents = flushed.events.map((event) => structuredClone(event))
        if (!promptFlushed && persistedEvents.some((event) => event.type === 'user/message')) {
          promptFlushed = true
          attachmentOrder.push('flush')
        }
      },
    },
  }
  agent.ctx = ctx
  const projectPolicy = {
    authorize: async () => cwd,
  }
  const executor = new HarnessAgentExecutor(ctx, projectPolicy)
  const registered = []
  const attached = []
  const result = await executor.execute({
    run: {
      snapshot: {
        task: { prompt: 'Run the visible task.' },
        execution: {
          cwd,
          permissionPreset: 'workspace-write',
          timeoutMs: 60_000,
        },
      },
    },
    signal: new AbortController().signal,
    registerSession: async (sessionId) => {
      registered.push(sessionId)
    },
    attachSession: async (sessionId) => {
      attached.push(sessionId)
      attachmentOrder.push('run')
    },
  })

  assert.equal(submitted.role, 'user')
  assert.deepEqual(submitted.source, { kind: 'user' })
  assert.deepEqual(submitted.content, [{ type: 'text', text: 'Run the visible task.' }])
  const persistedPrompt = persistedEvents.find((event) => event.type === 'user/message')
  assert.ok(persistedPrompt, 'the prompt must be present in durable session events')
  assert.deepEqual(persistedPrompt.data.source, { kind: 'user' })
  assert.deepEqual(persistedPrompt.data.content, [{ type: 'text', text: 'Run the visible task.' }])
  assert.deepEqual(registered, [result.sessionId])
  assert.equal(attached.length, 1)
  assert.equal(result.sessionId, attached[0])
  assert.equal(resolvedWorkspacePath, cwd)
  assert.deepEqual(workspaceSessions, [result.sessionId])
  assert.deepEqual(attachmentOrder, ['prompt', 'flush', 'workspace', 'run'])
  assert.equal(sessionEventListeners.size, 0)
  assert.equal(result.output, 'done')
})
