import { isAbsolute } from 'node:path'
import { validateCron } from './cron.js'
import type {
  AutomationJobSpec,
  AutomationPolicies,
  AgentExecutionSpec,
  AgentTaskSpec,
  MisfirePolicy,
  OverlapPolicy,
} from './types.js'

const JOB_ID = /^[a-z0-9](?:[a-z0-9-]{0,62})$/
const OVERLAP_POLICIES = new Set<OverlapPolicy>(['skip', 'queue', 'allow'])
const MISFIRE_POLICIES = new Set<MisfirePolicy>(['skip', 'run-once'])
const MAX_PROMPT_CHARS = 131_072
const MAX_NAME_CHARS = 120
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1_000
const MIN_TIMEOUT_MS = 1_000

export class AutomationInputError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code = 'INVALID_INPUT', status = 400, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AutomationInputError'
    this.code = code
    this.status = status
  }
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AutomationInputError(`${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed)
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key))
  if (unknown.length > 0) throw new AutomationInputError(`${path} contains unknown field(s): ${unknown.join(', ')}`)
}

function string(value: unknown, path: string, maxChars = 4_096): string {
  if (typeof value !== 'string') throw new AutomationInputError(`${path} must be a string`)
  const normalized = value.trim()
  if (normalized === '') throw new AutomationInputError(`${path} must not be empty`)
  if (normalized.length > maxChars) throw new AutomationInputError(`${path} must be at most ${maxChars} characters`)
  return normalized
}

function optionalString(value: unknown, path: string, maxChars = 512): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return string(value, path, maxChars)
}

function boolean(value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new AutomationInputError(`${path} must be a boolean`)
  return value
}

function integer(value: unknown, path: string, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new AutomationInputError(`${path} must be a safe integer between ${min} and ${max}`)
  }
  return value as number
}

export function normalizeJobId(value: string): string {
  const id = value.trim().toLowerCase()
  if (!JOB_ID.test(id)) {
    throw new AutomationInputError(
      'job id must match [a-z0-9][a-z0-9-]{0,62}',
      'INVALID_JOB_ID',
    )
  }
  return id
}

export function slugifyJobId(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug === '' ? 'automation' : slug
}

function normalizeTask(value: unknown): AgentTaskSpec {
  const task = object(value, 'spec.task')
  rejectUnknown(task, ['kind', 'prompt'], 'spec.task')
  if (task.kind !== undefined && task.kind !== 'agent') {
    throw new AutomationInputError('spec.task.kind must be "agent"')
  }
  return {
    kind: 'agent',
    prompt: string(task.prompt, 'spec.task.prompt', MAX_PROMPT_CHARS),
  }
}

function normalizeExecution(value: unknown): AgentExecutionSpec {
  const execution = object(value, 'spec.execution')
  rejectUnknown(
    execution,
    ['cwd', 'provider', 'model', 'reasoningEffort', 'agentPreset', 'permissionPreset', 'timeoutMs'],
    'spec.execution',
  )
  const cwd = string(execution.cwd, 'spec.execution.cwd', 8_192)
  if (!isAbsolute(cwd)) throw new AutomationInputError('spec.execution.cwd must be an absolute path')
  const provider = optionalString(execution.provider, 'spec.execution.provider')
  const model = optionalString(execution.model, 'spec.execution.model')
  if ((provider === undefined) !== (model === undefined)) {
    throw new AutomationInputError('spec.execution.provider and spec.execution.model must be set together or both omitted')
  }
  const reasoningEffort = optionalString(execution.reasoningEffort, 'spec.execution.reasoningEffort')
  const agentPreset = optionalString(execution.agentPreset, 'spec.execution.agentPreset')
  const permissionPreset = optionalString(execution.permissionPreset, 'spec.execution.permissionPreset') ?? 'workspace-write'
  const timeoutMs = integer(execution.timeoutMs, 'spec.execution.timeoutMs', 3_600_000, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
  return {
    cwd,
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    ...(agentPreset === undefined ? {} : { agentPreset }),
    permissionPreset,
    timeoutMs,
  }
}

function normalizePolicies(value: unknown): AutomationPolicies {
  const policies = value === undefined ? {} : object(value, 'spec.policies')
  rejectUnknown(policies, ['overlap', 'misfire'], 'spec.policies')
  const overlap = policies.overlap ?? 'skip'
  if (typeof overlap !== 'string' || !OVERLAP_POLICIES.has(overlap as OverlapPolicy)) {
    throw new AutomationInputError('spec.policies.overlap must be skip, queue, or allow')
  }
  const misfire = policies.misfire ?? 'run-once'
  if (typeof misfire !== 'string' || !MISFIRE_POLICIES.has(misfire as MisfirePolicy)) {
    throw new AutomationInputError('spec.policies.misfire must be skip or run-once')
  }
  return {
    overlap: overlap as OverlapPolicy,
    misfire: misfire as MisfirePolicy,
  }
}

export function normalizeJobSpec(value: unknown): AutomationJobSpec {
  const spec = object(value, 'spec')
  rejectUnknown(spec, ['name', 'enabled', 'schedule', 'task', 'execution', 'policies'], 'spec')
  const schedule = object(spec.schedule, 'spec.schedule')
  rejectUnknown(schedule, ['cron', 'timezone'], 'spec.schedule')
  const normalizedSchedule = validateCron(
    string(schedule.cron, 'spec.schedule.cron', 256),
    optionalString(schedule.timezone, 'spec.schedule.timezone', 256) ?? 'UTC',
  )
  return {
    name: string(spec.name, 'spec.name', MAX_NAME_CHARS),
    enabled: boolean(spec.enabled, 'spec.enabled', true),
    schedule: normalizedSchedule,
    task: normalizeTask(spec.task),
    execution: normalizeExecution(spec.execution),
    policies: normalizePolicies(spec.policies),
  }
}

export function assertExpectedVersion(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new AutomationInputError('expectedVersion must be a positive safe integer')
  }
  return value as number
}

export function assertJsonObject(value: unknown, path = 'request body'): Record<string, unknown> {
  return object(value, path)
}

export function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], path = 'request body'): void {
  rejectUnknown(value, allowed, path)
}
