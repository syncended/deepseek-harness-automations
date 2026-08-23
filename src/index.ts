import { isAbsolute, join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { expandHomePath, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-session'
import { HarnessAgentExecutor } from './agent-executor.js'
import { createAutomationHttpHandler } from './http.js'
import { ProjectPolicy } from './project-policy.js'
import { AutomationScheduler } from './scheduler.js'
import { AutomationStateStore } from './store.js'
import {
  type AutomationExecutor,
  type AutomationJob,
  type AutomationJobSpec,
  type AutomationMeta,
  type AutomationModelMeta,
  type AutomationRun,
  type AutomationServiceApi,
  type AutomationServiceConfig,
  type AutomationSnapshot,
  type CreateAutomationJobRequest,
  type UpdateAutomationJobRequest,
} from './types.js'
import {
  AutomationInputError,
  normalizeJobSpec,
} from './validation.js'

export * from './cron.js'
export * from './project-policy.js'
export * from './scheduler.js'
export * from './state.js'
export * from './store.js'
export * from './types.js'
export * from './validation.js'

export const name = 'automations'

const API_PREFIX = '/api/automations'

function resolvedStatePath(config: AutomationServiceConfig): string {
  if (config.statePath !== undefined) {
    const expanded = expandHomePath(config.statePath.trim())
    if (expanded === '' || !isAbsolute(expanded)) {
      throw new Error('automations: statePath must be an absolute path (a leading ~ is supported)')
    }
    return resolve(expanded)
  }
  return join(resolveDshHome(config.dshHome), 'automations', 'state.json')
}

export const Config = z.object({
  statePath: z.string(),
  dshHome: z.string(),
  maxConcurrentRuns: z.number().min(1).max(32).default(2),
  historyLimit: z.number().min(10).max(10_000).default(1_000),
  misfireGraceMs: z.number().min(0).max(86_400_000).default(60_000),
  maxOutputChars: z.number().min(1_024).max(1_048_576).default(65_536),
  allowedProjectRoots: z.array(z.string()).default([]),
})

/** Durable cron automation service and executor registry. */
export class AutomationService extends Service implements AutomationServiceApi {
  static Config = Config
  static inject = [
    'agents',
    'sessions',
    'agentDefaultModel',
    'agentPresets',
    'permissionPresets',
    'llm',
    'webServer',
  ]

  readonly statePath: string
  private readonly store: AutomationStateStore
  private readonly scheduler: AutomationScheduler
  private readonly configuredRoots: string[]
  private projectPolicy: ProjectPolicy | undefined

  constructor(ctx: Context, config: AutomationServiceConfig) {
    super(ctx, 'automations')
    this.statePath = resolvedStatePath(config)
    this.configuredRoots = config.allowedProjectRoots ?? []
    this.store = new AutomationStateStore(this.statePath, config.historyLimit ?? 1_000)
    this.scheduler = new AutomationScheduler({
      store: this.store,
      maxConcurrentRuns: config.maxConcurrentRuns ?? 2,
      misfireGraceMs: config.misfireGraceMs ?? 60_000,
      maxOutputChars: config.maxOutputChars ?? 65_536,
      logger: ctx.logger,
    })
  }

  async *[Service.init](): AsyncGenerator<() => Promise<void>, void, unknown> {
    this.projectPolicy = await ProjectPolicy.create(this.configuredRoots)
    await this.store.open(new Date())
    const unregisterExecutor = this.scheduler.registerExecutor(
      new HarnessAgentExecutor(this.ctx, this.projectPolicy),
    )
    let unregisterRoute: (() => void) | undefined
    try {
      await this.scheduler.start()
      unregisterRoute = this.ctx.webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: createAutomationHttpHandler(this, API_PREFIX, this.ctx.logger),
      })
    } catch (error) {
      await this.scheduler.stop().catch(() => undefined)
      unregisterExecutor()
      await this.store.close().catch(() => undefined)
      throw error
    }
    yield async () => {
      unregisterRoute?.()
      try {
        await this.scheduler.stop()
      } finally {
        unregisterExecutor()
        await this.store.close()
      }
    }
  }

  snapshot(limit?: number): AutomationSnapshot {
    return this.scheduler.snapshot(limit)
  }

  async create(input: CreateAutomationJobRequest): Promise<AutomationJob> {
    const spec = await this.prepareSpec(input.spec)
    return this.scheduler.create(spec, input.id)
  }

  async update(id: string, input: UpdateAutomationJobRequest): Promise<AutomationJob> {
    const spec = await this.prepareSpec(input.spec)
    return this.scheduler.update(id, spec, input.expectedVersion)
  }

  remove(id: string): Promise<void> {
    return this.scheduler.remove(id)
  }

  setEnabled(id: string, enabled: boolean, expectedVersion?: number): Promise<AutomationJob> {
    return this.scheduler.setEnabled(id, enabled, expectedVersion)
  }

  trigger(id: string): Promise<AutomationRun> {
    return this.scheduler.trigger(id)
  }

  cancel(runId: string, reason?: string): Promise<AutomationRun> {
    return this.scheduler.cancel(runId, reason)
  }

  registerExecutor(executor: AutomationExecutor): () => void {
    return this.scheduler.registerExecutor(executor)
  }

  async metadata(): Promise<AutomationMeta> {
    const selection = this.ctx.agentDefaultModel.currentSelection()
    const providers = await Promise.all(
      this.ctx.llm.listProviders().map(async (provider) => {
        try {
          const listedModels = await this.ctx.llm.listModels(provider.id)
          const models = listedModels.map((model) => ({
            id: model.id,
            name: model.name,
            ...(model.description === undefined ? {} : { description: model.description }),
          }))
          return { id: provider.id, name: provider.name, models }
        } catch (error) {
          this.ctx.logger.warn('automations: could not list models for provider %s', provider.id)
          this.ctx.logger.warn(error instanceof Error ? error.stack ?? error.message : String(error))
          return { id: provider.id, name: provider.name, models: [] }
        }
      }),
    )
    const agentPresets = (await this.ctx.agentPresets.list()).map((preset) => ({
      id: preset.id,
      name: preset.name ?? preset.id,
      ...(preset.broken === undefined ? {} : { broken: preset.broken }),
    }))
    return {
      defaultModel: {
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: String(selection.reasoningEffort) }),
      },
      providers,
      permissionPresets: [...this.ctx.permissionPresets.names],
      agentPresets,
    }
  }

  async modelMetadata(provider: string, model: string): Promise<AutomationModelMeta> {
    const resolved = await this.ctx.llm.resolveModelInfo(provider, model)
    const reasoning = resolved.reasoning === undefined
      ? undefined
      : {
          efforts: resolved.reasoning.efforts.map((effort) => ({
            id: String(effort.id),
            name: effort.name,
            ...(effort.description === undefined ? {} : { description: effort.description }),
          })),
          ...(resolved.reasoning.defaultEffort === undefined
            ? {}
            : { defaultEffort: String(resolved.reasoning.defaultEffort) }),
        }
    return {
      provider: resolved.provider,
      id: resolved.id,
      name: resolved.name,
      ...(resolved.description === undefined ? {} : { description: resolved.description }),
      ...(reasoning === undefined ? {} : { reasoning }),
    }
  }

  private async prepareSpec(input: AutomationJobSpec): Promise<AutomationJobSpec> {
    let spec
    try {
      spec = normalizeJobSpec(input)
    } catch (cause) {
      if (cause instanceof AutomationInputError) throw cause
      throw new AutomationInputError(cause instanceof Error ? cause.message : String(cause), 'INVALID_INPUT', 400, {
        cause,
      })
    }
    const projectPolicy = this.projectPolicy
    if (projectPolicy === undefined) throw new Error('automations: service is not initialized')
    const cwd = await projectPolicy.authorize(spec.execution.cwd)
    try {
      this.ctx.permissionPresets.resolve(spec.execution.permissionPreset)
    } catch (cause) {
      throw new AutomationInputError(
        `unknown permission preset "${spec.execution.permissionPreset}"`,
        'UNKNOWN_PERMISSION_PRESET',
        400,
        { cause },
      )
    }
    let preset
    try {
      preset = await this.ctx.agentPresets.resolve(spec.execution.agentPreset)
    } catch (cause) {
      throw new AutomationInputError(
        spec.execution.agentPreset === undefined
          ? 'the default agent preset is unavailable'
          : `unknown agent preset "${spec.execution.agentPreset}"`,
        'UNKNOWN_AGENT_PRESET',
        400,
        { cause },
      )
    }
    if (preset.broken !== undefined) {
      throw new AutomationInputError(
        `agent preset "${preset.id}" is broken: ${preset.broken}`,
        'BROKEN_AGENT_PRESET',
      )
    }
    return {
      ...spec,
      execution: {
        ...spec.execution,
        cwd,
      },
    }
  }
}

export default AutomationService
