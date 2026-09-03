'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Pause, Play } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import {
  civilKey, dayKey, marksFor, markOf, timeLabel, readableDay,
  dayPauseAction, pausableOn,
  DOT_CLASS_SM, RING_CLASS, DOT_LABEL, type DayMark,
} from '@/lib/schedule-calendar'
import { getZonedParts, zoneById, type CivilDate } from '@/lib/timezone'
import type { PortalArticle } from './PortalView'

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function startOfMonthWeekday({ year, month }: CivilDate) {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
}
function daysInMonth({ year, month }: CivilDate) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}
function sameDay(a: CivilDate, b: CivilDate) {
  return a.year === b.year && a.month === b.month && a.day === b.day
}

interface Props {
  open: boolean
  onClose: () => void
  articles: PortalArticle[]
  siteName?: string | null
  /** Read an article. Closes the calendar on the way. */
  onOpenArticle: (a: PortalArticle) => void
  /** Approve or pause one article — the same switch the article page carries. */
  onSetPaused: (articleId: string, paused: boolean) => Promise<void>
}

/**
 * The client's month view of their own schedule.
 *
 * The same calendar the team schedules against, drawn from the articles the
 * portal has already loaded rather than a fetch of its own — same rings, same
 * dots, same two-titles-then-a-count in a day cell, so a client and their
 * account manager are looking at one picture and not two.
 *
 * What it does not carry is the picker half: hour, zone and Save exist to place
 * a new article, and a client places nothing. What is left is what a client can
 * actually act on — read an article, or hold a day so none of it goes out.
 */
export default function PortalCalendar({
  open, onClose, articles, siteName, onOpenArticle, onSetPaused,
}: Props) {
  // The day the calendar opens on: where the queue actually is, not wherever
  // today happens to fall. A portal opened in a quiet month would otherwise
  // show an empty grid and hide the run of articles a month either side.
  const start = useMemo<CivilDate>(() => {
    const now = Date.now()
    const upcoming = articles
      .filter((a) => a.status !== 'published' && a.scheduled_at)
      .map((a) => a.scheduled_at as string)
      .filter((iso) => new Date(iso).getTime() > now)
      .sort()

    const anchor = upcoming[0]
      // Nothing still to come: fall back to the most recent thing that went
      // out, so the month shown has something in it either way.
      || articles
        .map((a) => a.published_at || a.scheduled_at)
        .filter(Boolean)
        .sort()
        .pop()

    const p = getZonedParts(anchor ? new Date(anchor) : new Date(), zoneById('PST'))
    return { year: p.year, month: p.month, day: p.day }
    // Recomputed only for a different set of articles — not as the modal is
    // opened and closed, so paging to March and back does not snap to today.
  }, [articles])

  const [view, setView] = useState<CivilDate>(start)
  /** The day being held or released, keyed as "2026-08-30". */
  const [busyDay, setBusyDay] = useState<string | null>(null)

  const byDay = useMemo(() => {
    const map = new Map<string, PortalArticle[]>()
    for (const a of articles) {
      const k = dayKey(a)
      if (!k) continue
      const list = map.get(k) || []
      list.push(a)
      map.set(k, list)
    }
    return map
  }, [articles])

  /**
   * Hold or release a whole day.
   *
   * One press per article underneath, because that is what the portal's pause
   * route takes and each one is logged for the team separately. Articles
   * already in the state being asked for are left alone.
   */
  async function toggleDay(key: string, posts: PortalArticle[]) {
    const action = dayPauseAction(posts)
    if (!action) return
    const paused = action === 'pause'
    const targets = pausableOn(posts).filter((p) => p.is_paused !== paused)
    if (!targets.length) return

    setBusyDay(key)
    try {
      // Sequential rather than in parallel: each of these logs an event and
      // refreshes the portal behind the modal, and the pause route is not
      // something to fire six of at once for one click.
      for (const a of targets) await onSetPaused(a.id, paused)
    } finally {
      setBusyDay(null)
    }
  }

  const today = getZonedParts(new Date(), zoneById('PST'))
  const lead = startOfMonthWeekday(view)
  const total = daysInMonth(view)
  const monthLabel = new Date(Date.UTC(view.year, view.month - 1, 1)).toLocaleString('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  })

  function shiftMonth(delta: number) {
    const d = new Date(Date.UTC(view.year, view.month - 1 + delta, 1))
    setView({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: 1 })
  }

  const inMonth = articles.filter((a) => {
    const k = dayKey(a)
    return !!k && k.startsWith(`${view.year}-${String(view.month).padStart(2, '0')}`)
  }).length

  return (
    <Modal open={open} onClose={onClose} title="Your calendar" maxWidth="max-w-5xl">
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
        {siteName ? `Everything queued and published for ${siteName}. ` : ''}
        Click an article to read it, or hold a day to stop it going out.
      </p>

      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          aria-label="Previous month"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-semibold text-gray-900 dark:text-white">{monthLabel}</span>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          aria-label="Next month"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((d, i) => (
          <div key={i} className="text-[11px] font-medium text-gray-400 text-center py-1">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: lead }).map((_, i) => <div key={`lead-${i}`} />)}
        {Array.from({ length: total }).map((_, i) => {
          const day = i + 1
          const cell: CivilDate = { year: view.year, month: view.month, day }
          const isToday = sameDay(cell, today)
          const cellKey = civilKey(view.year, view.month, day)
          const posts = byDay.get(cellKey) || []
          const pauseAction = dayPauseAction(posts)
          // Every state the day carries, not just the strongest: a day that
          // published one article and has another queued is two facts.
          const marks: DayMark[] = marksFor(posts)
          const ringMark: DayMark | undefined = marks[0]
          const restMarks = marks.slice(1)
          // Two fit without the grid growing a scrollbar; the rest are counted
          // rather than dropped, so a busy day never looks quiet.
          const shownPosts = posts.slice(0, 2)
          const overflow = posts.length - shownPosts.length

          return (
            <div
              key={day}
              className={`relative flex flex-col items-stretch text-left min-h-[5.75rem] p-1.5 rounded-lg text-sm ${
                isToday
                  ? 'text-brand-600 dark:text-brand-400 font-semibold'
                  : 'text-gray-700 dark:text-gray-300'
              } ${posts.length ? 'bg-gray-50 dark:bg-gray-900/40' : ''}`}
            >
              <span className="flex items-center justify-between gap-1">
                {/* The strongest mark is drawn round the number rather than
                    beside it: the number is where the eye already is. */}
                <span
                  className={`inline-flex items-center justify-center w-6 h-6 rounded-full tabular-nums ${
                    ringMark ? RING_CLASS[ringMark] : ''
                  }`}
                >
                  {day}
                </span>
                <span className="flex items-center gap-1">
                  {restMarks.map((m) => (
                    <span key={m} className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${DOT_CLASS_SM[m]}`} />
                  ))}

                  {/* Hold or release the whole day. A day is the unit the
                      calendar is drawn in, and "not this Tuesday" is the thing
                      a client asks for. Published days have no control —
                      there is nothing left to hold. */}
                  {pauseAction && (
                    <button
                      type="button"
                      className={`w-5 h-5 flex items-center justify-center rounded-md transition-colors flex-shrink-0 disabled:opacity-50 ${
                        pauseAction === 'resume'
                          ? 'text-amber-500 hover:text-[#39ff14] hover:bg-gray-100 dark:hover:bg-gray-700'
                          : 'text-gray-400 hover:text-amber-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                      disabled={busyDay === cellKey}
                      onClick={() => toggleDay(cellKey, posts)}
                      title={
                        pauseAction === 'pause'
                          ? `Pause everything scheduled on ${readableDay(cellKey)}`
                          : `Approve ${readableDay(cellKey)} for publishing`
                      }
                      aria-label={
                        pauseAction === 'pause'
                          ? `Pause everything scheduled on ${readableDay(cellKey)}`
                          : `Approve ${readableDay(cellKey)} for publishing`
                      }
                    >
                      {busyDay === cellKey ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : pauseAction === 'pause' ? (
                        <Pause className="w-3.5 h-3.5" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </span>
              </span>

              {/* What is on the day, not just that something is. Each title is
                  its own button — this calendar has nothing else to click a
                  day for, so the article is the target. */}
              {shownPosts.length > 0 && (
                <span className="mt-1 flex flex-col gap-0.5 min-w-0">
                  {shownPosts.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { onClose(); onOpenArticle(p) }}
                      title={`${timeLabel(p)} — ${p.title}`}
                      className="flex items-start gap-1 min-w-0 rounded text-left hover:bg-white dark:hover:bg-gray-700/60"
                    >
                      <span className={`w-1 h-1 mt-[0.3rem] rounded-full flex-shrink-0 ${DOT_CLASS_SM[markOf(p)]}`} />
                      {/* Two lines rather than one clipped one: a title cut
                          after three words says a day is busy without saying
                          what with, which is the one thing the cell is for. */}
                      <span className="block line-clamp-2 break-words text-[10px] font-normal leading-tight text-gray-500 dark:text-gray-400">
                        {p.title}
                      </span>
                    </button>
                  ))}
                  {overflow > 0 && (
                    <span className="block text-[10px] font-normal leading-tight text-gray-400 dark:text-gray-500">
                      +{overflow} more
                    </span>
                  )}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Rings, because rings are what the grid draws — a legend of dots would
          be explaining a mark that is not up there. */}
      <div className="flex flex-wrap items-center gap-3 mt-3 text-[11px] text-gray-400 dark:text-gray-500">
        {(['scheduled', 'paused', 'published'] as DayMark[]).map((m) => (
          <span key={m} className="flex items-center gap-1.5">
            <span className={`w-3.5 h-3.5 rounded-full ${RING_CLASS[m]}`} /> {DOT_LABEL[m]}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <Pause className="w-3 h-3" /> / <Play className="w-3 h-3" /> Hold a day
        </span>
        {!inMonth && (
          <span className="ml-auto">Nothing in {monthLabel} — try the arrows.</span>
        )}
      </div>
    </Modal>
  )
}
