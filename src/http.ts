import type { IncomingMessage, ServerResponse } from 'node:http'
import { AutomationInputError, assertExpectedVersion, assertJsonObject, assertOnlyKeys } from './validation.js'
import type { AutomationRun, AutomationServiceApi } from './types.js'

const MAX_BODY_BYTES = 1_048_576

interface HttpLogger {
  warn(message: string, ...args: unknown[]): void
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = `${JSON.stringify(value)}\n`
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(body)
}

function publicRun(run: AutomationRun): Record<string, unknown> {
  const visible: Record<string, unknown> = { ...run }
  delete visible.snapshot
  return visible
}

function methodNotAllowed(response: ServerResponse, allowed: string[]): void {
  response.setHeader('allow', allowed.join(', '))
  sendJson(response, 405, {
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: `Allowed method(s): ${allowed.join(', ')}`,
    },
  })
}

function mutationFence(request: IncomingMessage): void {
  if (request.headers['x-dsh-automation-client'] !== '1') {
    throw new AutomationInputError('missing automation mutation header', 'MUTATION_FENCE', 403)
  }
  const contentType = request.headers['content-type'] ?? ''
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new AutomationInputError('mutations require application/json', 'UNSUPPORTED_MEDIA_TYPE', 415)
  }
  const fetchSite = request.headers['sec-fetch-site']
  if (fetchSite !== undefined && fetchSite !== 'same-origin') {
    throw new AutomationInputError('cross-origin automation mutation refused', 'CROSS_ORIGIN', 403)
  }
  const origin = request.headers.origin
  const host = request.headers.host
  if (origin !== undefined) {
    let originHost
    try {
      originHost = new URL(origin).host
    } catch (cause) {
      throw new AutomationInputError('invalid Origin header', 'CROSS_ORIGIN', 403, { cause })
    }
    if (host === undefined || originHost.toLowerCase() !== host.toLowerCase()) {
      throw new AutomationInputError('Origin does not match the Harness host', 'CROSS_ORIGIN', 403)
    }
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new AutomationInputError('request body is too large', 'BODY_TOO_LARGE', 413)
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (cause) {
    throw new AutomationInputError('request body is not valid JSON', 'INVALID_JSON', 400, { cause })
  }
}

function segment(value: string, label: string): string {
  try {
    const decoded = decodeURIComponent(value)
    if (decoded === '' || decoded.includes('/')) throw new Error('invalid path segment')
    return decoded
  } catch (cause) {
    throw new AutomationInputError(`${label} path segment is invalid`, 'INVALID_PATH', 400, { cause })
  }
}

function requiredQueryString(url: URL, name: string): string {
  const value = url.searchParams.get(name)?.trim()
  if (value === undefined || value === '' || value.length > 512) {
    throw new AutomationInputError(`${name} must be a non-empty string of at most 512 characters`)
  }
  return value
}

function parseAutomationSessionsRevision(url: URL): number | undefined {
  const raw = url.searchParams.get('revision')
  if (raw === null) return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AutomationInputError('revision must be a non-negative safe integer')
  }
  return value
}

function parseLimit(url: URL): number {
  const raw = url.searchParams.get('limit')
  if (raw === null) return 100
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000) {
    throw new AutomationInputError('limit must be an integer between 1 and 1000')
  }
  return value
}

export function createAutomationHttpHandler(
  service: AutomationServiceApi,
  prefix: string,
  logger: HttpLogger,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://dsh.local')
      const relative = url.pathname.slice(prefix.length).replace(/^\/+|\/+$/g, '')
      const parts = relative === '' ? [] : relative.split('/')
      const method = request.method ?? 'GET'

      if (parts.length === 0) {
        if (method !== 'GET') return methodNotAllowed(response, ['GET'])
        const snapshot = service.snapshot(parseLimit(url))
        return sendJson(response, 200, {
          ...snapshot,
          // Executor snapshots remain durable server-side but need not duplicate prompts in API responses.
          runs: snapshot.runs.map(publicRun),
        })
      }
      if (parts.length === 1 && parts[0] === 'sessions') {
        if (method !== 'GET') return methodNotAllowed(response, ['GET'])
        const snapshot = service.snapshot(1)
        const revision = parseAutomationSessionsRevision(url)
        if (revision === snapshot.automationSessionsRevision) {
          return sendJson(response, 200, {
            revision: snapshot.automationSessionsRevision,
            unchanged: true,
          })
        }
        return sendJson(response, 200, {
          revision: snapshot.automationSessionsRevision,
          sessionIds: snapshot.automationSessionIds,
        })
      }
      if (parts.length === 1 && parts[0] === 'meta') {
        if (method !== 'GET') return methodNotAllowed(response, ['GET'])
        return sendJson(response, 200, await service.metadata())
      }
      if (parts.length === 2 && parts[0] === 'meta' && parts[1] === 'model') {
        if (method !== 'GET') return methodNotAllowed(response, ['GET'])
        const provider = requiredQueryString(url, 'provider')
        const model = requiredQueryString(url, 'model')
        return sendJson(response, 200, await service.modelMetadata(provider, model))
      }
      if (parts.length === 1 && parts[0] === 'jobs') {
        if (method !== 'POST') return methodNotAllowed(response, ['POST'])
        mutationFence(request)
        const body = assertJsonObject(await readJson(request))
        assertOnlyKeys(body, ['id', 'spec'])
        if (body.id !== undefined && typeof body.id !== 'string') {
          throw new AutomationInputError('id must be a string')
        }
        const job = await service.create({
          spec: body.spec as never,
          ...(body.id === undefined ? {} : { id: body.id }),
        })
        return sendJson(response, 201, job)
      }
      if (parts.length >= 2 && parts[0] === 'jobs') {
        const id = segment(parts[1]!, 'job id')
        if (parts.length === 2 && method === 'PUT') {
          mutationFence(request)
          const body = assertJsonObject(await readJson(request))
          assertOnlyKeys(body, ['expectedVersion', 'spec'])
          const expectedVersion = assertExpectedVersion(body.expectedVersion)
          const job = await service.update(id, {
            spec: body.spec as never,
            ...(expectedVersion === undefined ? {} : { expectedVersion }),
          })
          return sendJson(response, 200, job)
        }
        if (parts.length === 2 && method === 'DELETE') {
          mutationFence(request)
          // DELETE still carries an explicit empty JSON object to stay behind the same mutation fence.
          const body = assertJsonObject(await readJson(request))
          assertOnlyKeys(body, [])
          await service.remove(id)
          response.writeHead(204, { 'cache-control': 'no-store' })
          response.end()
          return
        }
        if (parts.length === 3 && parts[2] === 'run') {
          if (method !== 'POST') return methodNotAllowed(response, ['POST'])
          mutationFence(request)
          const body = assertJsonObject(await readJson(request))
          assertOnlyKeys(body, [])
          return sendJson(response, 202, publicRun(await service.trigger(id)))
        }
        if (parts.length === 3 && parts[2] === 'enabled') {
          if (method !== 'POST') return methodNotAllowed(response, ['POST'])
          mutationFence(request)
          const body = assertJsonObject(await readJson(request))
          assertOnlyKeys(body, ['enabled', 'expectedVersion'])
          if (typeof body.enabled !== 'boolean') throw new AutomationInputError('enabled must be a boolean')
          const expectedVersion = assertExpectedVersion(body.expectedVersion)
          return sendJson(
            response,
            200,
            await service.setEnabled(id, body.enabled, expectedVersion),
          )
        }
        return sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Automation API route not found.' } })
      }
      if (parts.length === 3 && parts[0] === 'runs' && parts[2] === 'cancel') {
        if (method !== 'POST') return methodNotAllowed(response, ['POST'])
        mutationFence(request)
        const body = assertJsonObject(await readJson(request))
        assertOnlyKeys(body, ['reason'])
        if (body.reason !== undefined && typeof body.reason !== 'string') {
          throw new AutomationInputError('reason must be a string')
        }
        const runId = segment(parts[1]!, 'run id')
        return sendJson(response, 202, publicRun(await service.cancel(runId, body.reason)))
      }
      return sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Automation API route not found.' } })
    } catch (error) {
      const status = error instanceof AutomationInputError ? error.status : 500
      const code = error instanceof AutomationInputError ? error.code : 'INTERNAL_ERROR'
      const message = error instanceof Error ? error.message : String(error)
      if (status >= 500) logger.warn('automations: HTTP request failed: %s', message)
      const publicMessage = status >= 500 ? 'Internal automation error.' : message
      if (!response.headersSent) sendJson(response, status, { error: { code, message: publicMessage } })
      else response.destroy(error instanceof Error ? error : new Error(message))
    }
  }
}
