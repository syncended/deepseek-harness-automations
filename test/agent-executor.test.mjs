import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { SessionTitleInvalidError } from '@deepseek-ai/dsh-session-title'
import { applyAutomationSessionTitle, HarnessAgentExecutor } from '../dist/agent-executor.js'

for (const api of ['events', 'snapshotEvents']) {
  test(`records a visible prompt and attaches the session to its DSH workspace (${api})`, async (t) => {
    const created = await mkdtemp(join(tmpdir(), 'dsh-automations-agent-'))
    const cwd = await realpath(created)
    t.after(() => rm(created, { recursive: true, force: true }))

    let submitted
    let persistedEvents = []
    let resolvedWorkspacePath
    const workspaceSessions = []
    const renamed = []
    const attachmentOrder = []
    const sessionEventListeners = new Set()
    let promptFlushed = false
    let finishTurn
    let turnSettled = Promise.resolve()
    const events = []
    const session = { seq: 0, ...(api === 'events'
      ? { events }
      : { snapshotEvents() { return Object.freeze([...events]) } }) }
    const agent = {
      session,
      whenIdle() { return turnSettled },
      followup(message) {
        submitted = message
        const firstEvent = { seq: session.seq, type: 'user/message', data: message }
        events.push(
          firstEvent,
          { seq: session.seq + 1, type: 'turn/start' },
        )
        session.seq += 2
        turnSettled = new Promise((resolve) => {
          finishTurn = () => {
            events.push(
              {
                seq: session.seq,
                type: 'assistant/message',
                data: { message: { content: [{ type: 'text', text: 'done' }] } },
              },
              { seq: session.seq + 1, type: 'turn/end', data: { reason: { kind: 'completed' } } },
            )
            session.seq += 2
            resolve()
          }
        })
        attachmentOrder.push('prompt')
        for (const listener of sessionEventListeners) listener(session, firstEvent)
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
      sessionTitle: {
        rename(renamedSession, title) {
          assert.equal(renamedSession, session)
          renamed.push(title)
          events.push({
            seq: session.seq,
            type: 'session/title',
            data: { title, messageSeqs: [], source: { kind: 'user' } },
          })
          session.seq += 1
        },
      },
      sessions: {
        flush: async (flushed) => {
          assert.equal(flushed, session)
          persistedEvents = events.map((event) => structuredClone(event))
          if (!promptFlushed && persistedEvents.some((event) => event.type === 'user/message')) {
            promptFlushed = true
            attachmentOrder.push('flush')
            queueMicrotask(finishTurn)
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
        jobId: 'nightly-reports',
        jobName: 'Nightly reports',
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
    const persistedTitle = persistedEvents.find((event) => event.type === 'session/title')
    assert.equal(persistedTitle?.data.title, 'Nightly reports')
    assert.deepEqual(persistedTitle?.data.source, { kind: 'user' })
    assert.deepEqual(renamed, ['Nightly reports'])
    assert.deepEqual(registered, [result.sessionId])
    assert.equal(attached.length, 1)
    assert.equal(result.sessionId, attached[0])
    assert.equal(resolvedWorkspacePath, cwd)
    assert.deepEqual(workspaceSessions, [result.sessionId])
    assert.deepEqual(attachmentOrder, ['prompt', 'flush', 'workspace', 'run'])
    assert.equal(sessionEventListeners.size, 0)
    assert.equal(result.output, 'done')
})

}

test('falls back to the automation id when its legacy name is not a visible title', () => {
  const session = {}
  const renamed = []
  const service = {
    rename(actualSession, title) {
      assert.equal(actualSession, session)
      renamed.push(title)
      if (title === '\u001b[31m') throw new SessionTitleInvalidError('invalid title')
    },
  }

  applyAutomationSessionTitle(service, session, {
    jobId: 'legacy-automation',
    jobName: '\u001b[31m',
  })

  assert.deepEqual(renamed, ['\u001b[31m', 'legacy-automation'])
})
