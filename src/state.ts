import type {
  AutomationJob,
  AutomationRun,
  AutomationRunStatus,
  AutomationState,
} from './types.js'
import { STATE_SCHEMA_VERSION } from './types.js'

export const TERMINAL_RUN_STATUSES = new Set<AutomationRunStatus>([
  'succeeded',
  'failed',
  'cancelled',
  'timed-out',
  'skipped',
  'interrupted',
])

export function isTerminalRunStatus(status: AutomationRunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status)
}

export function createEmptyState(): AutomationState {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    workspaceMembershipMigrationVersion: 0,
    revision: 0,
    jobs: {},
    runs: {},
    runOrder: [],
    occurrences: {},
  }
}

export function orderedJobs(state: AutomationState): AutomationJob[] {
  return Object.values(state.jobs).sort((left, right) => {
    const byName = left.name.localeCompare(right.name)
    return byName === 0 ? left.id.localeCompare(right.id) : byName
  })
}

export function orderedRuns(state: AutomationState, limit = Number.POSITIVE_INFINITY): AutomationRun[] {
  const ids = state.runOrder.slice(Math.max(0, state.runOrder.length - limit)).reverse()
  return ids.flatMap((id) => {
    const run = state.runs[id]
    return run === undefined ? [] : [run]
  })
}

export function activeRunsForJob(state: AutomationState, jobId: string): AutomationRun[] {
  return state.runOrder.flatMap((id) => {
    const run = state.runs[id]
    if (run === undefined || run.jobId !== jobId || isTerminalRunStatus(run.status)) return []
    return [run]
  })
}
