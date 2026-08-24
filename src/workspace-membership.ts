import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
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

// v0.8.2 made automation prompts user-visible but did not yet attach their
// sessions to workspaces. That release boundary lets the one-time migration
// recover sessions even when their bounded run and job records are gone.
const VISIBLE_AUTOMATION_PROMPT_RELEASED_AT = Date.parse('2026-08-24T12:56:39.000Z')

function isAutomationSession(events: readonly SessionEvent[], header: SessionHeader): boolean {
  return events.some((event) => {
    if (event.type !== 'user/message') return false
    const source = event.data.source
    if (source.kind === 'plugin' && source.plugin === AUTOMATION_PLUGIN_ID) return true
    return source.kind === 'user'
      && !('rpcId' in source)
      && header.agentPreset !== undefined
      && header.createdAt >= VISIBLE_AUTOMATION_PROMPT_RELEASED_AT
  })
}

/** One-time discovery for automation sessions already pruned from bounded run history. */
export async function backfillPrunedAutomationWorkspaceMembership(
  ctx: Context,
  logger: WorkspaceReconcileLogger,
): Promise<boolean> {
  const registry = automationWorkspaceRegistry(ctx)
  const grouped = new Set(registry.list().flatMap((workspace) => workspace.sessionIds))
  const workspaceByCwd = new Map<string, Workspace | undefined>()
  let complete = true
  let headers
  try {
    headers = await ctx.sessionPersistence.list()
  } catch (error) {
    logger.warn('automations: could not list persisted sessions for workspace migration')
    logger.warn(error instanceof Error ? error.stack ?? error.message : String(error))
    return false
  }

  for (const header of headers) {
    if (header.cwd === undefined || grouped.has(header.id)) continue
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
      const inspection = await ctx.sessionPersistence.inspect(header.id)
      if (!isAutomationSession(inspection.events, header)) continue
      await workspace.attachSession(header.id)
      grouped.add(header.id)
    } catch (error) {
      complete = false
      logger.warn('automations: could not migrate persisted session %s into its workspace', header.id)
      logger.warn(error instanceof Error ? error.stack ?? error.message : String(error))
    }
  }
  return complete
}
