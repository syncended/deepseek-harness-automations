import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { Workspace, WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { AUTOMATION_PLUGIN_ID, type AutomationRun } from './types.js'

interface WorkspaceReconcileLogger {
  warn(message: string, ...args: unknown[]): void
}

export function automationWorkspaceRegistry(ctx: Context): WorkspaceRegistry {
  return ctx.workspaceRegistry
}

/** Restore durable workspace ownership for automation sessions created by older releases. */
export async function reconcileAutomationWorkspaceMembership(
  ctx: Context,
  runs: readonly AutomationRun[],
  logger: WorkspaceReconcileLogger,
): Promise<void> {
  const sessionsByCwd = new Map<string, SessionId[]>()
  for (const run of runs) {
    if (run.sessionId === undefined) continue
    const cwd = run.snapshot.execution.cwd
    const sessionIds = sessionsByCwd.get(cwd) ?? []
    sessionIds.push(run.sessionId as SessionId)
    sessionsByCwd.set(cwd, sessionIds)
  }

  const registry = automationWorkspaceRegistry(ctx)
  for (const [cwd, sessionIds] of sessionsByCwd) {
    let workspace
    try {
      workspace = await registry.resolveByPath(cwd)
    } catch (error) {
      logger.warn('automations: could not resolve workspace for historical sessions at %s', cwd)
      logger.warn(error instanceof Error ? error.stack ?? error.message : String(error))
      continue
    }
    if (workspace === undefined) continue
    for (const sessionId of sessionIds) {
      try {
        await workspace.attachSession(sessionId)
      } catch (error) {
        logger.warn('automations: could not attach historical session %s to workspace %s', sessionId, cwd)
        logger.warn(error instanceof Error ? error.stack ?? error.message : String(error))
      }
    }
  }
}

// Plugin-sourced first prompts are the only unambiguous historical marker.
// Visible user-sourced prompts are recovered from retained run records instead
// of permanently labelling unrelated headless/preset sessions by heuristic.
function isAutomationSession(events: readonly SessionEvent[]): boolean {
  const firstUserMessage = events.find((event) => event.type === 'user/message')
  return firstUserMessage?.type === 'user/message'
    && firstUserMessage.data.source.kind === 'plugin'
    && firstUserMessage.data.source.plugin === AUTOMATION_PLUGIN_ID
}

export interface AutomationWorkspaceBackfillResult {
  complete: boolean
  sessionIds: SessionId[]
}

/** One-time discovery for automation sessions already pruned from bounded run history. */
export async function backfillPrunedAutomationWorkspaceMembership(
  ctx: Context,
  logger: WorkspaceReconcileLogger,
): Promise<AutomationWorkspaceBackfillResult> {
  const registry = automationWorkspaceRegistry(ctx)
  const grouped = new Set(registry.list().flatMap((workspace) => workspace.sessionIds))
  const workspaceByCwd = new Map<string, Workspace | undefined>()
  const sessionIds: SessionId[] = []
  let complete = true
  let headers
  try {
    headers = await ctx.sessionPersistence.list()
  } catch (error) {
    logger.warn('automations: could not list persisted sessions for workspace migration')
    logger.warn(error instanceof Error ? error.stack ?? error.message : String(error))
    return { complete: false, sessionIds }
  }

  for (const header of headers) {
    if (header.cwd === undefined) continue
    let automationSession = false
    try {
      const inspection = await ctx.sessionPersistence.inspect(header.id)
      automationSession = isAutomationSession(inspection.events)
    } catch (error) {
      complete = false
      logger.warn('automations: could not inspect persisted session %s during workspace migration', header.id)
      logger.warn(error instanceof Error ? error.stack ?? error.message : String(error))
      continue
    }
    if (!automationSession) continue
    sessionIds.push(header.id)
    if (grouped.has(header.id)) continue

    let workspace = workspaceByCwd.get(header.cwd)
    if (!workspaceByCwd.has(header.cwd)) {
      try {
        workspace = await registry.resolveByPath(header.cwd)
        workspaceByCwd.set(header.cwd, workspace)
      } catch (error) {
        complete = false
        logger.warn('automations: could not resolve workspace for persisted session %s', header.id)
        logger.warn(error instanceof Error ? error.stack ?? error.message : String(error))
        continue
      }
    }
    if (workspace === undefined) continue

    try {
      await workspace.attachSession(header.id)
      grouped.add(header.id)
    } catch (error) {
      complete = false
      logger.warn('automations: could not migrate persisted session %s into its workspace', header.id)
      logger.warn(error instanceof Error ? error.stack ?? error.message : String(error))
    }
  }
  return { complete, sessionIds }
}
