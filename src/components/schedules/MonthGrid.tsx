'use client'

import { useState } from 'react'
import { Loader2, Pause, Play } from 'lucide-react'
import {
  civilKey, marksFor, markOf, timeLabel, isMovable, dayPauseAction,
  DOT_CLASS_SM, RING_CLASS, DOT_LABEL, type DayMark,
} from '@/lib/schedule-calendar'
import type { CivilDate } from '@/lib/timezone'
import type { SiteColor } from '@/lib/site-colors'
import type { Article } from '@/types'

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
  /** The month on screen. */
  view: CivilDate
  /** Articles keyed by the day they land on. */
  byDay: Map<string, Article[]>
  /** Today, read in whichever zone the caller works in. */
  today: CivilDate
  /** "September 2026" — used in the cells' labels. */
  monthLabel: string
  /**
   * The day being picked, when this grid is a picker. Left out on a calendar
   * that is only being read, where nothing should look chosen.
   */
  selected?: CivilDate | null
  onPickDay?: (cell: CivilDate) => void
  /** A title was dropped on a day. */
  onMove: (article: Article, dayKey: string) => void
  /** The day's hold control was pressed. */
  onToggleDay: (dayKey: string, posts: Article[]) => void
  /** The article being written, and the day being held, so each can spin. */
  movingId: string | null
  busyDay: string | null
  /**
   * A colour for the site an article belongs to. Only passed by a calendar
   * showing more than one site — with one site there is nothing to tell apart,
   * and the grid is the plain one the picker draws.
   */
  colorOf?: (a: Article) => SiteColor | undefined
  /**
   * A label to pin above the weekdays — the month's own name, for a calendar
   * that stacks months in one scroller. Without it the grid draws the weekday
   * row on its own, exactly as a single month always has.
   */
  stickyHeader?: React.ReactNode
}

/**
 * A month of articles, in the one grid every calendar in the app draws.
 *
 * It came out of the scheduling picker, which is the calendar people know: a
 * ring round the day number for what the day holds, the titles themselves in
 * the cell, a hold control per day, and a title you can drag onto another day.
 * The publishing overview draws the same thing rather than a second calendar
 * that has to be learned separately — and the two cannot drift, because there
 * is only one of them.
 */
export default function MonthGrid({
  view, byDay, today, monthLabel, selected = null, onPickDay,
  onMove, onToggleDay, movingId, busyDay, colorOf, stickyHeader,
}: Props) {
  /** The article under the cursor, and the day it is hovering over. */
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [overKey, setOverKey] = useState<string | null>(null)

  const lead = startOfMonthWeekday(view)
  const total = daysInMonth(view)

  function handleDrop(e: React.DragEvent, key: string) {
    e.preventDefault()
    const id = draggingId || e.dataTransfer.getData('text/plain')
    setDraggingId(null)
    setOverKey(null)
    for (const posts of byDay.values()) {
      const article = posts.find((p) => p.id === id)
      if (article) { onMove(article, key); return }
    }
  }

  return (
    <>
      {/* The month's name and its weekdays are one block, so a scroller full
          of months can pin them together and the letters always sit over the
          columns they name. */}
      <div
        className={stickyHeader
          ? 'sticky top-0 z-20 bg-white dark:bg-gray-800 pt-2 pb-1'
          : 'mb-1'}
      >
        {stickyHeader}
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((d, i) => (
            <div key={i} className="text-[11px] font-medium text-gray-400 text-center py-1">{d}</div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: lead }).map((_, i) => <div key={`lead-${i}`} />)}
        {Array.from({ length: total }).map((_, i) => {
          const day = i + 1
          const cell: CivilDate = { year: view.year, month: view.month, day }
          const isSel = !!selected && sameDay(cell, selected)
          const isToday = sameDay(cell, today)
          const cellKey = civilKey(view.year, view.month, day)
          const posts = byDay.get(cellKey) || []
          const isOver = overKey === cellKey
          // Pause when anything on the day is still live, resume once none
          // is; null on a day with nothing left that could be held.
          const pauseAction = dayPauseAction(posts)
          // Every state the day carries, not just the strongest. A day that
          // published one article and has another queued is two different
          // facts, and collapsing them hid one of them.
          const marks: DayMark[] = marksFor(posts)
          const ringMark: DayMark | undefined = marks[0]
          const restMarks = marks.slice(1)
          // Three fit now the calendar has the full width and the cells grew
          // with it; the rest are counted rather than dropped, so a busy day
          // never looks quiet.
          const shownPosts = posts.slice(0, 3)
          const overflow = posts.length - shownPosts.length
          return (
            // A div, not a button: the cell now holds a pause control and
            // draggable titles, and a button inside a button is neither valid
            // nor draggable. Picking the day stays a real button underneath.
            <div
              key={day}
              onDragOver={(e) => {
                if (!draggingId) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setOverKey(cellKey)
              }}
              onDragLeave={() => setOverKey((k) => (k === cellKey ? null : k))}
              onDrop={(e) => handleDrop(e, cellKey)}
              className={`relative flex flex-col items-stretch text-left min-h-[7rem] p-2 rounded-lg text-sm transition-colors ${
                isSel
                  ? 'bg-brand-600 text-white font-semibold'
                  : isToday
                  ? 'text-brand-600 dark:text-brand-400 font-semibold'
                  : 'text-gray-700 dark:text-gray-300'
              } ${
                // ring-inset so the drop target lights up without spilling
                // over the neighbouring day in a 4px gap.
                isOver
                  ? 'ring-2 ring-inset ring-brand-500 bg-brand-50 dark:bg-brand-900/30'
                  : ''
              }`}
            >
              {/* Fills the cell and sits behind everything, so clicking any
                  empty part of the day still picks it -- as it did when the
                  whole cell was one button. */}
              <button
                type="button"
                onClick={() => onPickDay?.(cell)}
                title={
                  posts.length
                    ? posts.map((p) => `${timeLabel(p)} — ${p.title}`).join('\n')
                    : undefined
                }
                aria-label={
                  posts.length
                    ? `${monthLabel} ${day}: ${posts.length} article${posts.length > 1 ? 's' : ''}, ${marks.map((m) => DOT_LABEL[m]).join(' and ')}`
                    : `${monthLabel} ${day}`
                }
                className={`absolute inset-0 rounded-lg transition-colors ${
                  isSel ? '' : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              />

              <span className="relative pointer-events-none flex items-center justify-between gap-1">
                {/* The strongest mark is drawn round the number rather than
                    beside it: the number is where the eye already is, and a
                    ring reads at a glance where a dot in the corner did not.
                    Anything else the day carries stays a dot alongside, so a
                    day that published one article and has another queued is
                    still two facts and not one. */}
                <span
                  className={`inline-flex items-center justify-center w-6 h-6 rounded-full tabular-nums ${
                    ringMark ? (isSel ? 'ring-2 ring-white' : RING_CLASS[ringMark]) : ''
                  }`}
                >
                  {day}
                </span>
                <span className="flex items-center gap-1">
                  {restMarks.map((m) => (
                    <span
                      key={m}
                      // On the selected day the brand fill swallows the
                      // dot's own colour, so it goes white and keeps its
                      // position.
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        isSel ? 'bg-white' : DOT_CLASS_SM[m]
                      }`}
                    />
                  ))}

                  {/* Hold or release the whole day. One control rather than
                      one per article: a day is the unit the calendar is
                      already drawn in, and pausing "the 21st" is the thing
                      being asked for. Published days have none -- there is
                      nothing left to hold. */}
                  {pauseAction && (
                    <button
                      type="button"
                      // The header row is inert so clicks fall through to
                      // the day behind it; this one has to take its own.
                      className={`pointer-events-auto w-5 h-5 flex items-center justify-center rounded-md transition-colors flex-shrink-0 disabled:opacity-50 ${
                        isSel
                          ? 'text-white/80 hover:text-white hover:bg-white/20'
                          : pauseAction === 'resume'
                          ? 'text-amber-500 hover:text-[#39ff14] hover:bg-gray-100 dark:hover:bg-gray-700'
                          : 'text-gray-400 hover:text-amber-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                      disabled={busyDay === cellKey}
                      onClick={(e) => {
                        // Without this the click also lands on the backdrop
                        // and silently moves the slot being picked.
                        e.stopPropagation()
                        onToggleDay(cellKey, posts)
                      }}
                      title={
                        pauseAction === 'pause'
                          ? 'Pause everything scheduled this day'
                          : 'Resume this day'
                      }
                      aria-label={
                        pauseAction === 'pause'
                          ? `Pause everything scheduled on ${monthLabel} ${day}`
                          : `Resume ${monthLabel} ${day}`
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

              {/* What is on the day, not just that something is. Each line
                  carries its own dot, because a day can hold one article
                  already published and another still queued. */}
              {shownPosts.length > 0 && (
                <span className="relative mt-1 flex flex-col gap-0.5 min-w-0">
                  {shownPosts.map((p) => {
                    const movable = isMovable(p)
                    return (
                    // items-start, not items-center: the title runs to two
                    // lines now, and a centred dot would float beside the
                    // gap between them rather than sit on the first word.
                    <span
                      key={p.id}
                      draggable={movable && !movingId}
                      onDragStart={(e) => {
                        setDraggingId(p.id)
                        e.dataTransfer.setData('text/plain', p.id)
                        e.dataTransfer.effectAllowed = 'move'
                      }}
                      onDragEnd={() => { setDraggingId(null); setOverKey(null) }}
                      title={movable
                        ? `${timeLabel(p)} — ${p.title}\nDrag onto another day; the time stays the same.`
                        : `${timeLabel(p)} — ${p.title}\nAlready published, so it cannot be moved.`}
                      className={`pointer-events-auto flex items-start gap-1 min-w-0 rounded ${
                        movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
                      } ${draggingId === p.id ? 'opacity-40' : ''}`}
                    >
                      {/* Whose article it is, when the grid holds more than one
                          site's. A bar rather than another dot: the dot beside
                          it already carries the article's state, and two dots
                          saying different things is one too many. */}
                      {colorOf?.(p) && (
                        <span className={`w-0.5 self-stretch rounded-full flex-shrink-0 ${colorOf(p)!.bar}`} />
                      )}
                      {movingId === p.id ? (
                        <Loader2 className={`w-2 h-2 mt-[0.28rem] animate-spin flex-shrink-0 ${
                          isSel ? 'text-white' : 'text-gray-400'
                        }`} />
                      ) : (
                      <span
                        className={`w-1 h-1 mt-[0.3rem] rounded-full flex-shrink-0 ${
                          isSel ? 'bg-white' : DOT_CLASS_SM[markOf(p)]
                        }`}
                      />
                      )}
                      {/* Two lines rather than one clipped one. A title cut
                          after three words says a day is busy without saying
                          what with, which is the one thing the cell is for.
                          break-words so a long unbroken headline wraps
                          instead of pushing the column wide. */}
                      <span
                        className={`block line-clamp-2 break-words text-[10px] font-normal leading-tight ${
                          isSel ? 'text-white/90' : 'text-gray-500 dark:text-gray-400'
                        }`}
                      >
                        {p.title}
                      </span>
                    </span>
                    )
                  })}
                  {overflow > 0 && (
                    <span
                      className={`block text-[10px] font-normal leading-tight ${
                        isSel ? 'text-white/75' : 'text-gray-400 dark:text-gray-500'
                      }`}
                    >
                      +{overflow} more
                    </span>
                  )}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
