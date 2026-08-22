import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CronValidationError,
  latestCronOccurrence,
  nextCronOccurrence,
  validateCron,
} from '../dist/cron.js'

test('validates and normalizes a five-field cron with timezone', () => {
  assert.deepEqual(validateCron('  0   9  * * 1-5 ', 'UTC'), {
    cron: '0 9 * * 1-5',
    timezone: 'UTC',
  })
})

test('rejects second-resolution and invalid timezone input', () => {
  assert.throws(() => validateCron('0 0 9 * * 1-5', 'UTC'), CronValidationError)
  assert.throws(() => validateCron('H 9 * * *', 'UTC'), /replay-deterministic/)
  assert.throws(() => validateCron('0 9 * * *', 'Mars/Olympus_Mons'), CronValidationError)
})

test('calculates DST-aware next occurrence in an IANA timezone', () => {
  const next = nextCronOccurrence('30 9 * * *', 'Europe/Berlin', new Date('2026-03-28T10:00:00.000Z'))
  // Europe/Berlin moves from UTC+1 to UTC+2 on 2026-03-29.
  assert.equal(next.toISOString(), '2026-03-29T07:30:00.000Z')
})

test('coalesces a misfire to the latest occurrence', () => {
  const latest = latestCronOccurrence('*/15 * * * *', 'UTC', new Date('2026-02-01T12:44:59.000Z'))
  assert.equal(latest.toISOString(), '2026-02-01T12:30:00.000Z')
})
