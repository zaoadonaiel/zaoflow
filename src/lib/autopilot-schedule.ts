/**
 * Slot picker for Autopilot articles.
 *
 * Every autopilot article lands at a random minute inside a fixed 8:00–11:00
 * morning window in the site's own timezone. Randomised so two articles
 * queued minutes apart on the same tick don't both land at 08:00 sharp;
 * clamped to the site's zone so a Hawaii site never publishes at 8am
 * Eastern.
 *
 * The window itself is not user-configurable in v1 — the product decision
 * is that mornings ship well. If that ever changes the tick will pass in
 * a range rather than reading these constants.
 */

import { zonedWallClockToUtc, getZonedParts, zoneById, type CivilDate } from '@/lib/timezone'

const WINDOW_START_HOUR = 8   // 08:00 inclusive
const WINDOW_END_HOUR = 11    // 11:00 exclusive — the last minute rolled is 10:59

/**
 * A random UTC instant in the 08:00–10:59 wall-clock window on the given
 * civil date, read inside `zoneId`. Any of the SCHEDULE_ZONES ids works;
 * unknown ids fall back to UTC via `zoneById`.
 */
export function getRandomSlotInWindow(zoneId: string, civil: CivilDate): Date {
  const hour = WINDOW_START_HOUR + Math.floor(Math.random() * (WINDOW_END_HOUR - WINDOW_START_HOUR))
  const minute = Math.floor(Math.random() * 60)
  return zonedWallClockToUtc(civil, hour, minute, zoneById(zoneId))
}

/** The civil date "today" is inside the given zone (not UTC's today). */
export function todayInZone(zoneId: string, at: Date = new Date()): CivilDate {
  const p = getZonedParts(at, zoneById(zoneId))
  return { year: p.year, month: p.month, day: p.day }
}

/**
 * A civil date `offsetDays` after `civil`. Uses a UTC date object as a pure
 * calendar counter — no timezone semantics — since we only need day math,
 * not an instant.
 */
export function addDays(civil: CivilDate, offsetDays: number): CivilDate {
  const d = new Date(Date.UTC(civil.year, civil.month - 1, civil.day))
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}
