import { zoneById } from '@/lib/timezone'

/**
 * Shape of a "content alert" row — one site whose scheduled-article queue is
 * either empty or about to run dry. Computed server-side against the actual
 * scheduled_at values so the numbers match what the Articles page shows.
 */

/** Anything with less runway than this triggers a warning. Autopilot sites
 *  with 0 upcoming are ALWAYS flagged (that means the autopilot is broken)
 *  regardless of this threshold. */
export const LOW_RUNWAY_DAYS = 5

export type AlertSeverity = 'critical' | 'warning' | 'ok'

export interface ContentAlert {
  site_id: string
  site_name: string
  site_url: string
  site_type: 'wordpress' | 'nodejs' | 'other' | 'static'
  site_status: 'connected' | 'disconnected' | 'error'
  default_tz: string
  autopilot_enabled: boolean
  autopilot_paused: boolean
  upcoming_count: number
  /** ISO timestamp of the last scheduled article. Null when there are none. */
  last_scheduled_at: string | null
  /** Whole-day distance from today's date (in the site's zone) to the last
   *  scheduled article's date. Null when there are none. Negative not possible
   *  since we only count future scheduled_at. */
  days_remaining: number | null
  severity: AlertSeverity
  /** The line the UI actually shows. Built server-side so the phrasing is
   *  consistent no matter which surface renders it (page, badge tooltip). */
  message: string
}

/**
 * Whole-day distance from "today in zone" to "the wall-clock day of iso in zone".
 * We use civil-date subtraction rather than raw ms/86400000 so DST transitions
 * do not shift a boundary by an hour and mis-report "3 days" as "2 days".
 */
export function daysBetweenInZone(fromIso: string, toIso: string, zoneId: string): number {
  const tz = ianaZone(zoneId)
  const from = civilDateInZone(new Date(fromIso), tz)
  const to = civilDateInZone(new Date(toIso), tz)
  const fromUtc = Date.UTC(from.year, from.month - 1, from.day)
  const toUtc = Date.UTC(to.year, to.month - 1, to.day)
  return Math.round((toUtc - fromUtc) / 86_400_000)
}

function civilDateInZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const out: Record<string, number> = {}
  for (const p of parts) if (p.type !== 'literal') out[p.type] = Number(p.value)
  return { year: out.year, month: out.month, day: out.day }
}

/**
 * Site rows store the zone as 'HST'/'PST'/'MT'/'CT'/'EST' — the same short-ids
 * the scheduler uses. Translate to the IANA name Intl accepts, falling back to
 * UTC when the row is empty or already an IANA string it doesn't know.
 */
function ianaZone(zoneId: string | null | undefined): string {
  if (!zoneId) return 'UTC'
  const mapped = zoneById(zoneId)
  if (mapped && mapped !== 'UTC') return mapped
  // Might already be a full IANA name (e.g. legacy rows). Validate; fall back to UTC.
  try { new Intl.DateTimeFormat('en-US', { timeZone: zoneId }); return zoneId } catch { return 'UTC' }
}

export function formatShortDate(iso: string, zoneId: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ianaZone(zoneId),
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso))
}
