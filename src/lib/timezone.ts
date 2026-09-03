/**
 * Wall-clock <-> UTC conversion for the four zones the scheduler offers.
 *
 * A user picks "3 PM PST" — that is a wall-clock reading, not an instant. What
 * it means in UTC depends on the date, because of DST. Everything here exists
 * to resolve that correctly rather than assuming a fixed offset.
 */

export const SCHEDULE_ZONES = [
  { id: 'HST', label: 'HST', tz: 'Pacific/Honolulu' },
  { id: 'PST', label: 'PST', tz: 'America/Los_Angeles' },
  { id: 'CT',  label: 'Central', tz: 'America/Chicago' },
  { id: 'EST', label: 'EST', tz: 'America/New_York' },
] as const

export type ScheduleZoneId = (typeof SCHEDULE_ZONES)[number]['id']

export function zoneById(id: string): string {
  return SCHEDULE_ZONES.find((z) => z.id === id)?.tz ?? 'UTC'
}

/** The short name a time is shown under — "HST", "Central". */
export function zoneLabel(id: string): string {
  return SCHEDULE_ZONES.find((z) => z.id === id)?.label ?? 'UTC'
}

export interface CivilDate {
  year: number
  month: number
  day: number
}

// Falls back to UTC if a value Intl doesn't recognise ever reaches us, so a bad
// timezone string can never throw inside a render or a request handler.
function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return timeZone
  } catch {
    return 'UTC'
  }
}

/** The wall-clock reading of `date` inside `timeZone`. */
export function getZonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeZone(timeZone),
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)

  const out: Record<string, number> = {}
  for (const p of parts) {
    if (p.type !== 'literal') out[p.type] = Number(p.value)
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour % 24,
    minute: out.minute,
    second: out.second,
  }
}

/** How far `timeZone` sits from UTC at that instant, in ms (DST included). */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = getZonedParts(date, timeZone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime()
}

/**
 * A wall-clock time in `timeZone` -> the UTC instant it refers to.
 *
 * The offset depends on the instant and the instant depends on the offset, so
 * we guess once and settle. The second pass fixes guesses that landed on the
 * wrong side of a DST boundary.
 */
export function zonedWallClockToUtc(
  { year, month, day }: CivilDate,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const zone = safeZone(timeZone)
  const target = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  const firstGuess = zoneOffsetMs(new Date(target), zone)
  const settled = zoneOffsetMs(new Date(target - firstGuess), zone)
  return new Date(target - settled)
}

/** 12-hour clock + meridiem -> 24-hour hour. 12 AM is 0, 12 PM is 12. */
export function to24Hour(hour12: number, meridiem: 'AM' | 'PM'): number {
  const h = hour12 % 12
  return meridiem === 'PM' ? h + 12 : h
}

/**
 * Renders a stored UTC instant in the zone it was chosen in, with the zone
 * named so the reading is never ambiguous.
 *
 *   'long'    -> "Aug 25, 2026, 3:00 PM PST"
 *   'numeric' -> "08/25/2026 3:00 PM PST"
 */
export function formatInZone(
  iso: string,
  zoneId: string,
  style: 'long' | 'numeric' = 'long'
): string {
  const tz = safeZone(zoneById(zoneId))
  const label = zoneLabel(zoneId)
  const date = new Date(iso)

  if (style === 'numeric') {
    const d = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, month: '2-digit', day: '2-digit', year: 'numeric',
    }).format(date)
    const t = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(date)
    return `${d} ${t} ${label}`
  }

  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date)
  return `${formatted} ${label}`
}
