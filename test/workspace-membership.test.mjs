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
  const beforeVisiblePrompts = Date.parse('2026-08-24T12:56:38.000Z')
  const afterVisiblePrompts = Date.parse('2026-08-24T12:56:40.000Z')
  const headers = [
    { id: 'session-grouped', cwd: '/workspace', createdAt: beforeVisiblePrompts },
    { id: 'session-legacy', cwd: '/workspace', createdAt: beforeVisiblePrompts },
    {
      id: 'session-v082',
      cwd: '/workspace',
      createdAt: afterVisiblePrompts,
      agentPreset: 'default',
    },
    {
      id: 'session-ui',
      cwd: '/workspace',
      createdAt: afterVisiblePrompts,
      agentPreset: 'default',
    },
    { id: 'session-headless', cwd: '/workspace', createdAt: afterVisiblePrompts },
    { id: 'session-normal', cwd: '/workspace', createdAt: beforeVisiblePrompts },
    { id: 'session-no-cwd', createdAt: afterVisiblePrompts },
  ]
  const messages = new Map([
    ['session-legacy', {
      source: { kind: 'plugin', plugin: '@syncended/dsh-automations' },
      text: 'Legacy task',
    }],
    ['session-v082', { source: { kind: 'user' }, text: 'Scheduled task' }],
    ['session-ui', { source: { kind: 'user', rpcId: 'rpc-1' }, text: 'UI task' }],
    ['session-headless', { source: { kind: 'user' }, text: 'Headless task' }],
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

  const complete = await backfillPrunedAutomationWorkspaceMembership(ctx, { warn() {} })

  assert.equal(complete, true)
  assert.deepEqual(inspected, [
    'session-legacy',
    'session-v082',
    'session-ui',
    'session-headless',
    'session-normal',
  ])
  assert.deepEqual(attached, ['session-legacy', 'session-v082'])
})
