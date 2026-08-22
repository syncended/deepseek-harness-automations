import { CronExpressionParser } from 'cron-parser'

export class CronValidationError extends Error {
  readonly code = 'INVALID_CRON'

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CronValidationError'
  }
}

export function normalizeTimezone(value: string): string {
  const timezone = value.trim()
  if (timezone === '') throw new CronValidationError('timezone must not be empty')
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: timezone }).resolvedOptions().timeZone
  } catch (cause) {
    throw new CronValidationError(`invalid IANA timezone "${timezone}"`, { cause })
  }
}

export function normalizeCron(value: string): string {
  const cron = value.trim().replace(/\s+/g, ' ')
  if (cron.split(' ').length !== 5) {
    throw new CronValidationError('cron must contain exactly five fields: minute hour day-of-month month day-of-week')
  }
  if (/\bH(?:\([^)]*\))?(?:\/\d+)?\b/.test(cron)) {
    throw new CronValidationError('hashed H expressions are not supported because job schedules must be replay-deterministic')
  }
  return cron
}

export function validateCron(cronValue: string, timezoneValue: string): {
  cron: string
  timezone: string
} {
  const cron = normalizeCron(cronValue)
  const timezone = normalizeTimezone(timezoneValue)
  try {
    CronExpressionParser.parse(cron, {
      currentDate: new Date(),
      tz: timezone,
    })
  } catch (cause) {
    throw new CronValidationError(
      `invalid cron expression "${cron}": ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    )
  }
  return { cron, timezone }
}

/** First occurrence strictly after `after`. */
export function nextCronOccurrence(cronValue: string, timezoneValue: string, after: Date): Date {
  const { cron, timezone } = validateCron(cronValue, timezoneValue)
  try {
    return CronExpressionParser.parse(cron, {
      currentDate: after,
      tz: timezone,
    })
      .next()
      .toDate()
  } catch (cause) {
    throw new CronValidationError(
      `cannot calculate the next occurrence for "${cron}" in ${timezone}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    )
  }
}

/** Latest occurrence at or before `at`; useful for latest-only misfire coalescing. */
export function latestCronOccurrence(cronValue: string, timezoneValue: string, at: Date): Date {
  const { cron, timezone } = validateCron(cronValue, timezoneValue)
  try {
    return CronExpressionParser.parse(cron, {
      currentDate: new Date(at.getTime() + 1),
      tz: timezone,
    })
      .prev()
      .toDate()
  } catch (cause) {
    throw new CronValidationError(
      `cannot calculate the previous occurrence for "${cron}" in ${timezone}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    )
  }
}
