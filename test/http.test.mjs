import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { createAutomationHttpHandler } from '../dist/http.js'

function service() {
  const calls = []
  return {
    calls,
    snapshot(limit) {
      return {
        revision: 1,
        jobs: [],
        runs: [{ id: 'run-1', status: 'succeeded', snapshot: { task: { prompt: 'sensitive-prompt' } } }],
        automationSessionIds: ['session-automation'],
        automationSessionsRevision: 7,
        limit,
      }
    },
    async metadata() { return { defaultModel: { provider: 'p', model: 'm' }, providers: [], permissionPresets: [], agentPresets: [], statePath: '/tmp/state' } },
    async modelMetadata(provider, model) {
      calls.push(['model-metadata', provider, model])
      return { provider, id: model, name: model, reasoning: { efforts: [{ id: 'high', name: 'High' }] } }
    },
    async create(input) { calls.push(['create', input]); return { id: input.id ?? 'generated' } },
    async update(id, input) { calls.push(['update', id, input]); return { id } },
    async remove(id) { calls.push(['remove', id]) },
    async setEnabled(id, enabled, version) { calls.push(['enabled', id, enabled, version]); return { id, enabled } },
    async trigger(id) {
      calls.push(['trigger', id])
      return { id: 'run-1', jobId: id, snapshot: { task: { prompt: 'sensitive-prompt' } } }
    },
    async cancel(id, reason) {
      calls.push(['cancel', id, reason])
      return { id, snapshot: { task: { prompt: 'sensitive-prompt' } } }
    },
    registerExecutor() { return () => {} },
  }
}

async function withServer(t) {
  const api = service()
  const handler = createAutomationHttpHandler(api, '/api/automations', { warn() {} })
  const server = createServer((request, response) => handler(request, response))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
  const address = server.address()
  return { api, base: `http://127.0.0.1:${address.port}/api/automations` }
}

const mutationHeaders = {
  'content-type': 'application/json',
  'x-dsh-automation-client': '1',
}

test('serves snapshots and validates list limits', async (t) => {
  const { base } = await withServer(t)
  const response = await fetch(`${base}?limit=42`)
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.limit, 42)
  assert.equal(Object.hasOwn(body.runs[0], 'snapshot'), false)
  assert.equal(JSON.stringify(body).includes('sensitive-prompt'), false)
  assert.equal((await fetch(`${base}?limit=0`)).status, 400)
})

test('serves the durable automation session provenance index', async (t) => {
  const { base } = await withServer(t)
  const response = await fetch(`${base}/sessions`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    revision: 7,
    sessionIds: ['session-automation'],
  })
  assert.deepEqual(await (await fetch(`${base}/sessions?revision=7`)).json(), {
    revision: 7,
    unchanged: true,
  })
  assert.equal((await fetch(`${base}/sessions?revision=-1`)).status, 400)
  assert.equal((await fetch(`${base}/sessions`, { method: 'POST' })).status, 405)
})

test('serves exact-model reasoning metadata with validated query parameters', async (t) => {
  const { api, base } = await withServer(t)
  const response = await fetch(`${base}/meta/model?provider=openai-codex&model=gpt-5.6-sol`)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).reasoning.efforts[0].id, 'high')
  assert.deepEqual(api.calls, [['model-metadata', 'openai-codex', 'gpt-5.6-sol']])
  assert.equal((await fetch(`${base}/meta/model?provider=&model=gpt`)).status, 400)
  assert.equal((await fetch(`${base}/meta/model?provider=p`)).status, 400)
  assert.equal((await fetch(`${base}/meta/model?provider=${'p'.repeat(513)}&model=m`)).status, 400)
  assert.equal((await fetch(`${base}/meta/model?provider=p&model=m`, { method: 'POST' })).status, 405)
})

test('refuses mutations without the explicit same-origin fence', async (t) => {
  const { base } = await withServer(t)
  const missing = await fetch(`${base}/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ spec: {} }),
  })
  assert.equal(missing.status, 403)

  const crossSite = await fetch(`${base}/jobs`, {
    method: 'POST',
    headers: { ...mutationHeaders, 'sec-fetch-site': 'cross-site' },
    body: JSON.stringify({ spec: {} }),
  })
  assert.equal(crossSite.status, 403)
})

test('routes fenced create, trigger, toggle, and cancel mutations', async (t) => {
  const { api, base } = await withServer(t)
  const created = await fetch(`${base}/jobs`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({ id: 'daily', spec: { marker: true } }),
  })
  assert.equal(created.status, 201)
  assert.equal((await created.json()).id, 'daily')

  const trigger = await fetch(`${base}/jobs/daily/run`, {
    method: 'POST',
    headers: mutationHeaders,
    body: '{}',
  })
  assert.equal(trigger.status, 202)
  assert.equal(Object.hasOwn(await trigger.json(), 'snapshot'), false)

  const enabled = await fetch(`${base}/jobs/daily/enabled`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({ enabled: false, expectedVersion: 2 }),
  })
  assert.equal(enabled.status, 200)

  const cancel = await fetch(`${base}/runs/run-1/cancel`, {
    method: 'POST',
    headers: mutationHeaders,
    body: JSON.stringify({ reason: 'stop' }),
  })
  assert.equal(cancel.status, 202)
  assert.equal(Object.hasOwn(await cancel.json(), 'snapshot'), false)
  assert.deepEqual(api.calls.map((entry) => entry[0]), ['create', 'trigger', 'enabled', 'cancel'])
})
