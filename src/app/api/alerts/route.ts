import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  LOW_RUNWAY_DAYS,
  daysBetweenInZone,
  formatShortDate,
  type ContentAlert,
  type AlertSeverity,
} from '@/lib/content-alerts'

/**
 * Content Alerts feed — one row per site, saying whether that site's
 * scheduled-article queue is empty, running dry, or healthy.
 *
 * Runs entirely against existing columns (no migration). Everything is scoped
 * to the caller via RLS on both `sites` and `articles`.
 *
 * ?count=1 → returns only { count } for the sidebar badge, so the sidebar
 * does not have to parse a full alert list on every route change.
 */
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const countOnly = req.nextUrl.searchParams.get('count') === '1'

  // Analytics-only sites never publish articles from Zao Flo, so they can't
  // "run low". Everything else (wordpress/nodejs/static) is in scope.
  const { data: sites, error: sitesErr } = await supabase
    .from('sites')
    .select('id, name, url, site_type, status, default_tz, autopilot_enabled, autopilot_paused')
    .eq('user_id', user.id)
    .neq('site_type', 'other')

  if (sitesErr) return NextResponse.json({ error: sitesErr.message }, { status: 500 })
  if (!sites || sites.length === 0) {
    return countOnly ? NextResponse.json({ count: 0 }) : NextResponse.json({ alerts: [], healthy: [] })
  }

  const nowIso = new Date().toISOString()
  const siteIds = sites.map((s) => s.id)

  // Upcoming = scheduled, in the future, not paused, not archived.
  // Drafts don't count even if they have a scheduled_at — the user might not
  // have finalised them and they won't auto-publish. Matches the spec.
  const { data: upcoming, error: upErr } = await supabase
    .from('articles')
    .select('site_id, scheduled_at')
    .eq('user_id', user.id)
    .eq('status', 'scheduled')
    .eq('is_paused', false)
    .is('archived_at', null)
    .gt('scheduled_at', nowIso)
    .in('site_id', siteIds)

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  // Fold into per-site counts + latest scheduled_at.
  const bySite = new Map<string, { count: number; last: string | null }>()
  for (const s of sites) bySite.set(s.id, { count: 0, last: null })
  for (const row of upcoming || []) {
    const entry = bySite.get(row.site_id)
    if (!entry || !row.scheduled_at) continue
    entry.count += 1
    if (!entry.last || row.scheduled_at > entry.last) entry.last = row.scheduled_at
  }

  const alerts: ContentAlert[] = []
  const healthy: ContentAlert[] = []

  for (const site of sites) {
    const stats = bySite.get(site.id) ?? { count: 0, last: null }
    const zone = site.default_tz || 'PST'
    const daysRemaining =
      stats.last ? daysBetweenInZone(nowIso, stats.last, zone) : null

    // Autopilot on-and-not-paused is expected to top itself up. Only flag it
    // when the queue is genuinely empty (that means the tick is broken and
    // the user needs to know now, not tomorrow).
    const autopilotActive = site.autopilot_enabled && !site.autopilot_paused
    const isLow =
      stats.count === 0 ||
      (!autopilotActive && daysRemaining !== null && daysRemaining <= LOW_RUNWAY_DAYS)

    const severity: AlertSeverity =
      stats.count === 0 ? 'critical' : isLow ? 'warning' : 'ok'

    const message =
      stats.count === 0
        ? autopilotActive
          ? 'Autopilot is on but the queue is empty — likely a broken run.'
          : '0 upcoming articles.'
        : `${stats.count} upcoming article${stats.count === 1 ? '' : 's'}, ` +
          `last publishes ${formatShortDate(stats.last!, zone)} ` +
          `(${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left).`

    const row: ContentAlert = {
      site_id: site.id,
      site_name: site.name,
      site_url: site.url,
      site_type: site.site_type,
      site_status: site.status,
      default_tz: zone,
      autopilot_enabled: Boolean(site.autopilot_enabled),
      autopilot_paused: Boolean(site.autopilot_paused),
      upcoming_count: stats.count,
      last_scheduled_at: stats.last,
      days_remaining: daysRemaining,
      severity,
      message,
    }

    if (isLow) alerts.push(row)
    else healthy.push(row)
  }

  // Most urgent first: 0-count on top (critical), then fewest days.
  alerts.sort((a, b) => {
    if (a.upcoming_count !== b.upcoming_count) {
      // 0 beats non-0. Otherwise a smaller count beats a larger one.
      if (a.upcoming_count === 0) return -1
      if (b.upcoming_count === 0) return 1
      return a.upcoming_count - b.upcoming_count
    }
    const da = a.days_remaining ?? Number.POSITIVE_INFINITY
    const db = b.days_remaining ?? Number.POSITIVE_INFINITY
    return da - db
  })

  healthy.sort((a, b) => (a.days_remaining ?? 0) - (b.days_remaining ?? 0))

  if (countOnly) return NextResponse.json({ count: alerts.length })
  return NextResponse.json({ alerts, healthy })
}
