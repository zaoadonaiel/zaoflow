'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import toast from 'react-hot-toast'
import { getZonedParts, zoneById, zonedWallClockToUtc, SCHEDULE_ZONES } from '@/lib/timezone'
import { siteParam } from '@/lib/site-filter'
import type { Article } from '@/types'

/**
 * The shared reading of "what is on this site's calendar" — used by the site
 * overview and by the picker you schedule an article in, so both mark the same
 * days the same way rather than drifting apart.
 */

/** What each day's dot can mean, in the order it takes precedence. */
export type DayMark = 'scheduled' | 'paused' | 'published'

/**
 * The little an article has to carry to be drawn on a calendar.
 *
 * The dashboard passes whole `Article` rows; the client portal passes the
 * trimmed shape its own API returns. Both are welcome here — the marks, the
 * day grouping and the day's hold control read the same handful of fields
 * either way, and the two calendars stay one piece of code because of it.
 */
export interface CalendarArticle {
  id: string
  title: string
  status: string
  scheduled_at?: string | null
  scheduled_tz?: string | null
  published_at?: string | null
  is_paused?: boolean | null
}

/** The instant a calendar should file this article under. */
function instantOf(a: CalendarArticle): string | null {
  // A published article belongs on the day it actually went out; its
  // scheduled_at is only the slot it was aiming for.
  if (a.status === 'published') return a.published_at || a.scheduled_at || null
  return a.scheduled_at || null
}

/** "2026-08-25" from a civil date, the key every lookup here is on. */
export function civilKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * The day this article lands on, read in its own timezone.
 *
 * Grouping on the raw UTC date would push an 11 PM PST post onto the following
 * day, so the calendar would mark a day nothing publishes on.
 */
export function dayKey(a: CalendarArticle): string | null {
  const iso = instantOf(a)
  if (!iso) return null
  const p = getZonedParts(new Date(iso), zoneById(a.scheduled_tz || 'PST'))
  return civilKey(p.year, p.month, p.day)
}

/** "2:00 PM PST" — the slot in the zone it was picked in. */
export function timeLabel(a: CalendarArticle): string {
  const iso = instantOf(a)
  if (!iso) return ''
  const zoneId = a.scheduled_tz || 'PST'
  const label = SCHEDULE_ZONES.find((z) => z.id === zoneId)?.label ?? 'UTC'
  const t = new Intl.DateTimeFormat('en-US', {
    timeZone: zoneById(zoneId),
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso))
  return `${t} ${label}`
}

/** A "2026-09-16" key back into the three numbers it stands for. */
export function partsOfKey(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split('-').map(Number)
  return { year, month, day }
}

/**
 * The instant this article would hold if it moved to another day, keeping the
 * time it already publishes at.
 *
 * The time is read and rewritten in the article's own zone, so 9 AM PST stays
 * 9 AM PST across a move — including one that crosses a daylight saving
 * boundary, where holding the UTC instant steady would shift it by an hour.
 */
export function movedToDay(a: Article, key: string): string | null {
  const iso = a.scheduled_at
  if (!iso) return null
  const zone = zoneById(a.scheduled_tz || 'PST')
  const { hour, minute } = getZonedParts(new Date(iso), zone)
  return zonedWallClockToUtc(partsOfKey(key), hour, minute, zone).toISOString()
}

/** Only a queued article can be moved — a published one has already gone out. */
export function isMovable(a: CalendarArticle): boolean {
  return a.status !== 'published' && !!a.scheduled_at
}

/** Which marks a day's articles call for, strongest first. */
export function marksFor(posts: CalendarArticle[]): DayMark[] {
  const marks: DayMark[] = []
  if (posts.some((p) => p.status !== 'published' && !p.is_paused)) marks.push('scheduled')
  if (posts.some((p) => p.status !== 'published' && p.is_paused)) marks.push('paused')
  if (posts.some((p) => p.status === 'published')) marks.push('published')
  return marks
}

/** The one mark a single article carries. */
export function markOf(a: CalendarArticle): DayMark {
  if (a.status === 'published') return 'published'
  return a.is_paused ? 'paused' : 'scheduled'
}

/** How many articles on this day will actually go out. */
export function liveCount(posts: CalendarArticle[]): number {
  return posts.filter((p) => p.status !== 'published' && !p.is_paused).length
}

/** Only a queued article can be paused — a published one has already gone out. */
export function pausableOn<T extends CalendarArticle>(posts: T[]): T[] {
  return posts.filter((p) => p.status !== 'published')
}

/**
 * What a day's play/pause control should do when pressed.
 *
 * A day with anything still live pauses -- one press holds the whole day,
 * rather than asking which of three articles you meant. Only once nothing on
 * it is live does the control offer to resume. Null means the day holds
 * nothing that can be paused: it is empty, or everything on it has published.
 */
export function dayPauseAction(posts: CalendarArticle[]): 'pause' | 'resume' | null {
  const targets = pausableOn(posts)
  if (!targets.length) return null
  return targets.some((p) => !p.is_paused) ? 'pause' : 'resume'
}

/** "Wed, Sep 16" — what a move or a pause confirms it did. */
export function readableDay(key: string): string {
  const { year, month, day } = partsOfKey(key)
  return new Date(Date.UTC(year, month - 1, day))
    .toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/**
 * Moving an article to another day, and holding or releasing a whole day —
 * the two things a calendar can do to a schedule rather than just show it.
 *
 * It lives here rather than in either calendar because both of them offer the
 * same two actions, and a move made in the picker has to mean exactly what a
 * move made in the overview means: the same PATCH, the same guard against
 * dropping something into the past, the same mirroring onto WordPress.
 */
export function useScheduleActions(reload: () => void, onChanged?: () => void) {
  /** The article currently being written, so its own row can show a spinner. */
  const [movingId, setMovingId] = useState<string | null>(null)
  /** The day currently being held or released, keyed as "2026-08-30". */
  const [busyDay, setBusyDay] = useState<string | null>(null)

  const moveArticle = useCallback(async (article: Article, targetKey: string) => {
    if (dayKey(article) === targetKey) return
    if (!isMovable(article)) {
      toast.error('A published article cannot be moved.')
      return
    }

    // The time of day is kept and only the date changes, so an article that
    // publishes at 9 AM still publishes at 9 AM after the move.
    const iso = movedToDay(article, targetKey)
    if (!iso) return
    if (new Date(iso).getTime() <= Date.now()) {
      toast.error('That day is already past at this article\u2019s publish time.')
      return
    }

    setMovingId(article.id)
    try {
      const res = await fetch(`/api/articles/${article.id}/schedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduled_at: iso }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not move that article')
      if (data.wpWarning) toast.error(data.wpWarning, { duration: 8000 })
      else toast.success(`Moved to ${readableDay(targetKey)}`)
      reload()
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not move that article')
    } finally {
      setMovingId(null)
    }
  }, [reload, onChanged])

  /**
   * Hold or release every article on a day at once.
   *
   * Each one is its own PATCH because each has its own WordPress post to
   * mirror onto, and one of them failing must not silently take the rest of
   * the day down with it -- so the failures are counted and said out loud
   * while the successes stand.
   */
  const toggleDay = useCallback(async (dayKeyTarget: string, posts: Article[]) => {
    const action = dayPauseAction(posts)
    if (!action) return
    const paused = action === 'pause'
    // Articles already in the state being asked for are left alone rather than
    // written again: resuming a day of three where one is live is two writes.
    const targets = pausableOn(posts).filter((p) => !!p.is_paused !== paused)
    if (!targets.length) return

    setBusyDay(dayKeyTarget)
    try {
      const results = await Promise.all(targets.map(async (a) => {
        const res = await fetch(`/api/articles/${a.id}/schedule`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_paused: paused }),
        })
        const data = await res.json().catch(() => ({}))
        return { ok: res.ok, warning: data?.wpWarning as string | null, error: data?.error as string }
      }))

      const failed = results.filter((r) => !r.ok)
      const warning = results.find((r) => r.ok && r.warning)?.warning

      if (failed.length === results.length) {
        throw new Error(failed[0].error || `Could not ${action} that day`)
      }
      if (failed.length) {
        toast.error(
          `${results.length - failed.length} of ${results.length} articles ${paused ? 'held' : 'resumed'} — `
          + `${failed.length} could not be changed.`,
          { duration: 8000 }
        )
      } else if (warning) {
        toast.error(warning, { duration: 8000 })
      } else {
        toast.success(
          `${readableDay(dayKeyTarget)} ${paused ? 'paused' : 'resumed'}`
        )
      }
      reload()
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Could not ${action} that day`)
    } finally {
      setBusyDay(null)
    }
  }, [reload, onChanged])

  return { moveArticle, toggleDay, movingId, busyDay }
}

export interface SiteCalendar {
  /** Every article on the calendar, queued and already published. */
  articles: Article[]
  /** Articles keyed by their day, each list in time order. */
  byDay: Map<string, Article[]>
  /** Still queued — the count worth showing as "coming up". */
  queuedCount: number
  loading: boolean
  error: string | null
  reload: () => void
}

/**
 * Loads a site's calendar: what is queued and what has already gone out.
 *
 * `enabled` exists so a modal does not fetch until it is actually open.
 */
export function useSiteCalendar(siteId: string | null | undefined, enabled = true): SiteCalendar {
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!siteId) {
      setArticles([])
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [queued, published] = await Promise.all(
        (['scheduled', 'published'] as const).map(async (status) => {
          const res = await fetch(`/api/articles?status=${status}${siteParam(siteId)}`)
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || 'Could not load the calendar')
          return (data.articles || []) as Article[]
        })
      )
      setArticles([...queued, ...published])
      setError(null)
    } catch (err) {
      setArticles([])
      setError(err instanceof Error ? err.message : 'Could not load the calendar')
    } finally {
      setLoading(false)
    }
  }, [siteId])

  useEffect(() => {
    if (enabled) load()
  }, [enabled, load])

  const byDay = useMemo(() => {
    const map = new Map<string, Article[]>()
    for (const a of articles) {
      const k = dayKey(a)
      if (!k) continue
      const list = map.get(k) || []
      list.push(a)
      map.set(k, list)
    }
    for (const list of map.values()) {
      list.sort((x, y) => (instantOf(x) || '').localeCompare(instantOf(y) || ''))
    }
    return map
  }, [articles])

  const queuedCount = useMemo(
    () => articles.filter((a) => a.status !== 'published').length,
    [articles]
  )

  return { articles, byDay, queuedCount, loading, error, reload: load }
}

/** Tailwind classes for a day's dot. Filled vs hollow carries meaning too, so
 *  the marks do not collapse into one shape for a red-green eye.
 *
 *  Green is what is still to come, grey is what has already gone out. */
export const DOT_CLASS: Record<DayMark, string> = {
  scheduled: 'bg-[#39ff14]',
  paused: 'border-2 border-amber-500',
  published: 'bg-gray-400 dark:bg-gray-500',
}

/** The same marks at grid size, where a 2px ring would fill a 6px dot solid. */
export const DOT_CLASS_SM: Record<DayMark, string> = {
  scheduled: 'bg-[#39ff14]',
  paused: 'border border-amber-500',
  published: 'bg-gray-400 dark:bg-gray-500',
}

/**
 * The same marks drawn around the day number instead of beside it, for the
 * compact grid in the picker — a 6px dot in the corner of a cell that already
 * holds two titles is easy to miss, and the number is the thing the eye is on.
 *
 * Shape still carries the meaning alongside colour: solid for what is coming,
 * dashed for what is held, thin for what has already gone.
 */
export const RING_CLASS: Record<DayMark, string> = {
  scheduled: 'ring-2 ring-[#39ff14]',
  paused: 'border-2 border-dashed border-amber-500',
  published: 'ring-1 ring-gray-400 dark:ring-gray-500',
}

export const DOT_LABEL: Record<DayMark, string> = {
  scheduled: 'Scheduled',
  paused: 'Paused',
  published: 'Published',
}
