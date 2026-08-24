import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-permission-presets'
import { installModelSelection, type ModelSelection } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent, type TurnEndReason } from '@deepseek-ai/dsh-session'
import { ProjectPolicy } from './project-policy.js'
import type { AutomationExecutor, AutomationExecutorContext } from './types.js'

class AgentRunError extends Error {
  readonly code: string

  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AgentRunError'
    this.code = code
  }
}

interface RunSummary {
  text: string
  reason?: TurnEndReason
}

function summarize(events: readonly SessionEvent[], firstSeq: number): RunSummary {
  let started = false
  let text = ''
  let reason: TurnEndReason | undefined
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'turn/start') {
      started = true
      continue
    }
    if (!started) continue
    if (event.type === 'assistant/message') {
      const joined = event.data.message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
      if (joined !== '') text = joined
    }
    if (event.type === 'turn/end') reason = event.data.reason
  }
  return reason === undefined ? { text } : { text, reason }
}

function failureFromReason(reason: TurnEndReason | undefined): AgentRunError {
  if (reason === undefined) return new AgentRunError('The agent produced no terminal turn outcome.', 'MISSING_TURN_OUTCOME')
  if (reason.kind === 'error') {
    return new AgentRunError(reason.error.message, reason.error.code)
  }
  if (reason.kind === 'blocked') return new AgentRunError('The agent turn was blocked.', 'TURN_BLOCKED')
  if (reason.kind === 'max-tokens') return new AgentRunError('The agent reached its output-token limit.', 'TURN_MAX_TOKENS')
  if (reason.kind === 'aborted') return new AgentRunError('The agent turn was aborted.', 'TURN_ABORTED')
  if (reason.kind === 'interrupted') return new AgentRunError('The agent turn was interrupted by a previous host crash.', 'TURN_INTERRUPTED')
  return new AgentRunError(`The agent ended with unsupported reason "${String((reason as { kind: string }).kind)}".`, 'TURN_FAILED')
}

async function assertCanonicalDirectory(cwd: string): Promise<void> {
  const [metadata, canonical] = await Promise.all([stat(cwd), realpath(cwd)])
  if (!metadata.isDirectory()) throw new AgentRunError(`Workspace path is not a directory: ${cwd}`, 'PROJECT_NOT_DIRECTORY')
  if (canonical !== cwd) {
    throw new AgentRunError(
      `Workspace path no longer resolves to its saved filesystem identity: expected ${cwd}, found ${canonical}`,
      'PROJECT_IDENTITY_CHANGED',
    )
  }
}

function resolveSelection(ctx: Context, run: AutomationExecutorContext['run']): ModelSelection {
  const execution = run.snapshot.execution
  const current = ctx.agentDefaultModel.currentSelection()
  const provider = execution.provider ?? current.provider
  const model = execution.model ?? current.model
  const reasoningEffort = execution.reasoningEffort === undefined
    ? execution.provider === undefined
      ? current.reasoningEffort
      : undefined
    : ReasoningEffortId(execution.reasoningEffort)
  return {
    provider,
    model,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  }
}

/** Runs one admitted automation through a fresh, persisted, preset-composed Harness Agent. */
export class HarnessAgentExecutor implements AutomationExecutor {
  readonly kind = 'agent'
  private readonly ctx: Context
  private readonly projectPolicy: ProjectPolicy

  constructor(ctx: Context, projectPolicy: ProjectPolicy) {
    this.ctx = ctx
    this.projectPolicy = projectPolicy
  }

  async execute(context: AutomationExecutorContext): Promise<{ sessionId: string; output?: string }> {
    const { run, signal } = context
    const execution = run.snapshot.execution
    const authorizedCwd = await this.projectPolicy.authorize(execution.cwd)
    await assertCanonicalDirectory(authorizedCwd)
    if (signal.aborted) throw signal.reason

    const preset = await this.ctx.agentPresets.resolve(execution.agentPreset)
    if (preset.broken !== undefined) {
      throw new AgentRunError(`Agent preset "${preset.id}" is broken: ${preset.broken}`, 'BROKEN_AGENT_PRESET')
    }
    this.ctx.permissionPresets.resolve(execution.permissionPreset)
    const selection = resolveSelection(this.ctx, run)
    const sessionId = SessionId(`session-${randomUUID()}`)
    const handle = await this.ctx.agents.create({
      sessionId,
      meta: {
        cwd: execution.cwd,
        agentPreset: preset.id,
      },
      agentOptions: {
        provider: selection.provider,
        model: selection.model,
      },
      signal,
      setup: async (agentCtx) => {
        await this.ctx.agentPresets.mount(agentCtx, preset.id)
        installModelSelection(agentCtx, {
          current: selection,
          assembled: undefined,
        })
        const agent = agentCtx.agent
        if (agent === undefined) throw new AgentRunError('Agent setup context has no agent.', 'AGENT_SETUP_FAILED')
        this.ctx.permissionPresets.set(agent.session, execution.permissionPreset)
      },
    })

    const { agent } = handle
    const cancel = () => {
      agent.cancel({
        kind: 'hook',
        reason: signal.reason instanceof Error ? signal.reason.message : 'automation run aborted',
      })
    }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      await context.attachSession(String(sessionId))
      if (signal.aborted) throw signal.reason
      await agent.whenIdle()
      const firstSeq = agent.session.seq
      agent.followup(
        createUserMessage({
          content: [
            {
              type: 'text',
              text: run.snapshot.task.prompt,
            },
          ],
          // This is the run's actual human-authored prompt, not injected
          // plugin context. The conversation UI renders user-sourced messages
          // as visible chat turns and plugin-sourced messages as context.
          source: { kind: 'user' },
        }),
      )
      await agent.whenIdle()
      if (signal.aborted) throw signal.reason
      await this.ctx.sessions.flush(agent.session)
      const outcome = summarize(agent.session.events, firstSeq)
      if (outcome.reason?.kind !== 'completed') throw failureFromReason(outcome.reason)
      return {
        sessionId: String(sessionId),
        ...(outcome.text === '' ? {} : { output: outcome.text }),
      }
    } finally {
      signal.removeEventListener('abort', cancel)
      await this.ctx.sessions.flush(agent.session).catch(() => undefined)
      await handle.dispose().catch(() => undefined)
    }
  }
}
