import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AutomationInputError,
  normalizeJobId,
  normalizeJobSpec,
  slugifyJobId,
} from '../dist/validation.js'

function rawSpec() {
  return {
    name: '  Weekday review  ',
    schedule: { cron: '0 9 * * 1-5', timezone: 'UTC' },
    task: { prompt: 'Review the repository.' },
    execution: { cwd: '/tmp/project' },
  }
}

test('normalizes a minimal job and applies safe defaults', () => {
  const spec = normalizeJobSpec(rawSpec())
  assert.equal(spec.name, 'Weekday review')
  assert.equal(spec.enabled, true)
  assert.equal(spec.task.kind, 'agent')
  assert.equal(spec.execution.permissionPreset, 'workspace-write')
  assert.equal(spec.execution.timeoutMs, 3_600_000)
  assert.deepEqual(spec.policies, { overlap: 'skip', misfire: 'run-once' })
})

test('requires model and provider to be configured as a pair', () => {
  const spec = rawSpec()
  spec.execution.provider = 'deepseek'
  assert.throws(() => normalizeJobSpec(spec), AutomationInputError)
})

test('rejects relative projects, unknown keys, and six-field cron', () => {
  const relative = rawSpec()
  relative.execution.cwd = './project'
  assert.throws(() => normalizeJobSpec(relative), /absolute path/)

  const unknown = rawSpec()
  unknown.schedule.seconds = true
  assert.throws(() => normalizeJobSpec(unknown), /unknown field/)

  const seconds = rawSpec()
  seconds.schedule.cron = '0 0 9 * * 1-5'
  assert.throws(() => normalizeJobSpec(seconds), /exactly five fields/)
})

test('normalizes explicit ids and produces stable slugs', () => {
  assert.equal(normalizeJobId('daily-review'), 'daily-review')
  assert.equal(slugifyJobId('Daily repository review'), 'daily-repository-review')
  assert.throws(() => normalizeJobId('../escape'), AutomationInputError)
})
