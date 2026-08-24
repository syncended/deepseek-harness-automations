import assert from 'node:assert/strict'
import test from 'node:test'
import {
  backfillPrunedAutomationWorkspaceMembership,
  reconcileAutomationWorkspaceMembership,
} from '../dist/workspace-membership.js'

function historicalRun(sessionId, cwd) {
  return {
    ...(sessionId === undefined ? {} : { sessionId }),
    snapshot: { execution: { cwd } },
  }
}

test('reconciles historical automation sessions into their existing workspaces', async () => {
  const resolved = []
  const attached = []
  const warnings = []
  const ctx = {
    workspaceRegistry: {
      async resolveByPath(path) {
        resolved.push(path)
        if (path === '/missing') return undefined
        if (path === '/broken') throw new Error('workspace lookup failed')
        return {
          async attachSession(sessionId) {
            attached.push([path, sessionId])
          },
        }
      },
    },
  }
  const logger = {
    warn(message, ...args) {
      warnings.push([message, ...args])
    },
  }

  await reconcileAutomationWorkspaceMembership(ctx, [
    historicalRun('session-one', '/workspace'),
    historicalRun('session-two', '/workspace'),
    historicalRun(undefined, '/workspace'),
    historicalRun('session-missing', '/missing'),
    historicalRun('session-broken', '/broken'),
  ], logger)

  assert.deepEqual(resolved, ['/workspace', '/missing', '/broken'])
  assert.deepEqual(attached, [
    ['/workspace', 'session-one'],
    ['/workspace', 'session-two'],
  ])
  assert.equal(warnings.length, 2)
  assert.match(String(warnings[0][0]), /could not resolve workspace/)
  assert.match(String(warnings[1][0]), /workspace lookup failed/)
})

test('backfills pruned legacy automation sessions from session persistence once', async () => {
  const attached = []
  const inspected = []
  const workspace = {
    sessionIds: ['session-grouped'],
    async attachSession(sessionId) {
      attached.push(sessionId)
    },
  }
  const headers = [
    { id: 'session-grouped', cwd: '/workspace' },
    { id: 'session-legacy', cwd: '/workspace' },
    { id: 'session-v082', cwd: '/workspace' },
    { id: 'session-normal', cwd: '/workspace' },
    { id: 'session-no-cwd' },
  ]
  const messages = new Map([
    ['session-legacy', {
      source: { kind: 'plugin', plugin: '@syncended/dsh-automations' },
      text: 'Legacy task',
    }],
    ['session-v082', { source: { kind: 'user' }, text: 'Scheduled task' }],
    ['session-normal', { source: { kind: 'user' }, text: 'Hello' }],
  ])
  const ctx = {
    workspaceRegistry: {
      list: () => [workspace],
      resolveByPath: async () => workspace,
    },
    sessionPersistence: {
      list: async () => headers,
      async inspect(sessionId) {
        inspected.push(sessionId)
        const message = messages.get(sessionId)
        return {
          events: [{
            type: 'user/message',
            data: {
              source: message.source,
              content: [{ type: 'text', text: message.text }],
            },
          }],
        }
      },
    },
  }

  const complete = await backfillPrunedAutomationWorkspaceMembership(ctx, [{
    execution: { cwd: '/workspace' },
    task: { prompt: 'Scheduled task' },
  }], { warn() {} })

  assert.equal(complete, true)
  assert.deepEqual(inspected, ['session-legacy', 'session-v082', 'session-normal'])
  assert.deepEqual(attached, ['session-legacy', 'session-v082'])
})
