import type { Context } from '@deepseek-ai/cordis'

export const STATE_SCHEMA_VERSION = 1 as const
export const WORKSPACE_MEMBERSHIP_MIGRATION_VERSION = 2 as const
export const AUTOMATION_PLUGIN_ID = '@syncended/dsh-automations' as const

export type OverlapPolicy = 'skip' | 'queue' | 'allow'
export type MisfirePolicy = 'skip' | 'run-once'
export type AutomationTrigger = 'cron' | 'manual'
export type AutomationRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed-out'
  | 'skipped'
  | 'interrupted'

export interface CronSchedule {
  /** Standard five-field cron expression: minute hour day-of-month month day-of-week. */
  cron: string
  /** UTC or an IANA timezone such as Europe/Berlin. */
  timezone: string
}

export interface AgentExecutionSpec {
  /** Absolute workspace directory and immutable Session cwd/root. */
  cwd: string
  /** Omitted provider and model resolve from the current Harness default at dispatch time. */
  provider?: string
  model?: string
  reasoningEffort?: string
  /** Omitted preset resolves to the current Harness agent-preset default. */
  agentPreset?: string
  /** Harness permission preset (sandbox mode + approval policy). */
  permissionPreset: string
  /** Wall-clock limit for this run. */
  timeoutMs: number
}

export interface AgentTaskSpec {
  kind: 'agent'
  prompt: string
}

export interface AutomationPolicies {
  overlap: OverlapPolicy
  misfire: MisfirePolicy
}

/** User-owned, versioned definition. Scheduler projection fields do not belong here. */
export interface AutomationJobSpec {
  name: string
  enabled: boolean
  schedule: CronSchedule
  task: AgentTaskSpec
  execution: AgentExecutionSpec
  policies: AutomationPolicies
}

export interface AutomationJob extends AutomationJobSpec {
  id: string
  version: number
  createdAt: string
  updatedAt: string
  /** Durable scheduler watermark; null while disabled. */
  nextRunAt: string | null
}

/** Full immutable execution snapshot pinned when an occurrence is admitted. */
export interface AutomationRunSnapshot extends AutomationJobSpec {
  jobId: string
  jobVersion: number
}

export interface AutomationRunError {
  code: string
  message: string
}

export interface AutomationRun {
  id: string
  occurrenceKey: string
  jobId: string
  jobVersion: number
  jobName: string
  trigger: AutomationTrigger
  scheduledFor: string
  status: AutomationRunStatus
  createdAt: string
  startedAt?: string
  finishedAt?: string
  sessionId?: string
  output?: string
  error?: AutomationRunError
  skipReason?: 'overlap' | 'misfire' | 'job-disabled' | 'job-deleted'
  snapshot: AutomationRunSnapshot
}

export interface AutomationState {
  schemaVersion: typeof STATE_SCHEMA_VERSION
  workspaceMembershipMigrationVersion: number
  /** Durable provenance index retained independently of bounded run history. */
  automationSessionIds: string[]
  /** Changes only when a new provenance id is added. */
  automationSessionsRevision: number
  revision: number
  jobs: Record<string, AutomationJob>
  runs: Record<string, AutomationRun>
  /** Newest last; stable ordering without relying on object-key ordering. */
  runOrder: string[]
  /** Durable idempotency index from occurrence key to run id. */
  occurrences: Record<string, string>
}

export interface AutomationSnapshot {
  revision: number
  jobs: AutomationJob[]
  runs: AutomationRun[]
  automationSessionIds: string[]
  automationSessionsRevision: number
}

export interface CreateAutomationJobRequest {
  spec: AutomationJobSpec
  id?: string
}

export interface UpdateAutomationJobRequest {
  spec: AutomationJobSpec
  expectedVersion?: number
}

export interface ExecutorRunResult {
  sessionId?: string
  output?: string
}

export interface AutomationExecutorContext {
  run: AutomationRun
  signal: AbortSignal
  /** Persist automation provenance as soon as the Harness session exists. */
  registerSession(sessionId: string): Promise<void>
  /** Publish the session link after its visible prompt is durable. */
  attachSession(sessionId: string): Promise<void>
}

/** Future workflow/task-graph executors plug into this seam without touching cron admission. */
export interface AutomationExecutor {
  readonly kind: AgentTaskSpec['kind'] | (string & {})
  execute(context: AutomationExecutorContext): Promise<ExecutorRunResult>
}

export interface SchedulerClock {
  now(): Date
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>
  clearTimeout(handle: ReturnType<typeof setTimeout>): void
}

export interface AutomationServiceConfig {
  statePath?: string
  dshHome?: string
  maxConcurrentRuns?: number
  historyLimit?: number
  misfireGraceMs?: number
  maxOutputChars?: number
  allowedProjectRoots?: string[]
}

export interface AutomationModelMeta {
  provider: string
  id: string
  name: string
  description?: string
  reasoning?: {
    efforts: Array<{
      id: string
      name: string
      description?: string
    }>
    defaultEffort?: string
  }
}

export interface AutomationMeta {
  defaultModel: {
    provider: string
    model: string
    reasoningEffort?: string
  }
  providers: Array<{
    id: string
    name: string
    models: Array<{
      id: string
      name: string
      description?: string
    }>
  }>
  permissionPresets: string[]
  agentPresets: Array<{
    id: string
    name: string
    broken?: string
  }>
}

export interface AutomationServiceApi {
  snapshot(limit?: number): AutomationSnapshot
  create(input: CreateAutomationJobRequest): Promise<AutomationJob>
  update(id: string, input: UpdateAutomationJobRequest): Promise<AutomationJob>
  remove(id: string): Promise<void>
  setEnabled(id: string, enabled: boolean, expectedVersion?: number): Promise<AutomationJob>
  trigger(id: string): Promise<AutomationRun>
  cancel(runId: string, reason?: string): Promise<AutomationRun>
  metadata(): Promise<AutomationMeta>
  modelMetadata(provider: string, model: string): Promise<AutomationModelMeta>
  registerExecutor(executor: AutomationExecutor): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    automations: AutomationServiceApi
  }
}

/** Compile-time assertion that the public service can be carried on a Cordis context. */
export type AutomationContext = Context & { automations: AutomationServiceApi }
