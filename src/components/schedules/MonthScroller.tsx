'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import MonthGrid from './MonthGrid'
import type { CivilDate } from '@/lib/timezone'
import type { SiteColor } from '@/lib/site-colors'
import type { Article } from '@/types'

/**
 * Every month, one after another, in a single scroll.
 *
 * A picker with a pair of arrows makes "some Tuesday in September" four clicks
 * away and hides the run-up to it: you never see the end of one month and the
 * start of the next together. Stacking the months and letting the list grow at
 * whichever end you reach means the calendar simply keeps going — back through
 * what has already published, forward as far as anyone wants to schedule.
 */

/** A month as one number, so stepping across a year boundary is addition. */
const indexOf = (d: { year: number; month: number }) => d.year * 12 + (d.month - 1)
const dateOf = (i: number): CivilDate => ({
  year: Math.floor(i / 12),
  month: (i % 12) + 1,
  day: 1,
})
const labelOf = (i: number) =>
  new Date(Date.UTC(Math.floor(i / 12), i % 12, 1)).toLocaleString('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  })

/** How many months are added each time an end comes into view. */
const CHUNK = 6
/** How close to an end counts as reaching it, in px. */
const EDGE = 400

interface Props {
  /** The month the calendar opens on — the slot being picked. */
  start: CivilDate
  byDay: Map<string, Article[]>
  today: CivilDate
  selected?: CivilDate | null
  onPickDay?: (cell: CivilDate) => void
  onMove: (article: Article, dayKey: string) => void
  onToggleDay: (dayKey: string, posts: Article[]) => void
  movingId: string | null
  busyDay: string | null
  colorOf?: (a: Article) => SiteColor | undefined
}

export default function MonthScroller({
  start, byDay, today, selected = null, onPickDay,
  onMove, onToggleDay, movingId, busyDay, colorOf,
}: Props) {
  const first = indexOf(start)
  // A month of history behind the slot and a year in front of it — enough that
  // the usual next-few-weeks decision needs no scrolling at all.
  const [range, setRange] = useState({ from: first - 1, to: first + 11 })

  const scroller = useRef<HTMLDivElement>(null)
  const anchor = useRef<HTMLDivElement>(null)
  /**
   * The scroll height captured just before months are added above, so the
   * months already on screen can be held still. Without it, growing the top of
   * the list yanks the calendar downwards under the cursor.
   */
  const heightBefore = useRef<number | null>(null)

  // Opens on the month the slot is in, not on the month that happens to be
  // first in the list.
  useLayoutEffect(() => {
    const el = scroller.current
    const a = anchor.current
    if (el && a) el.scrollTop = a.offsetTop
    // Once, on open. Scrolling afterwards is the user's business.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || heightBefore.current === null) return
    el.scrollTop += el.scrollHeight - heightBefore.current
    heightBefore.current = null
  }, [range.from])

  function onScroll() {
    const el = scroller.current
    if (!el) return
    if (el.scrollTop < EDGE) {
      // One prepend at a time: the next only after the compensation above has
      // put the scroll position back where it belongs.
      if (heightBefore.current === null) {
        heightBefore.current = el.scrollHeight
        setRange((r) => ({ ...r, from: r.from - CHUNK }))
      }
      return
    }
    if (el.scrollHeight - el.scrollTop - el.clientHeight < EDGE) {
      setRange((r) => ({ ...r, to: r.to + CHUNK }))
    }
  }

  const months: number[] = []
  for (let i = range.from; i <= range.to; i++) months.push(i)

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      // relative so each month's offsetTop is measured against this box.
      className="relative h-[58vh] overflow-y-auto pr-1"
    >
      {months.map((i) => {
        const view = dateOf(i)
        return (
          <div key={i} ref={i === first ? anchor : undefined} className="mb-4">
            <MonthGrid
              view={view}
              byDay={byDay}
              today={today}
              monthLabel={labelOf(i)}
              selected={selected}
              onPickDay={onPickDay}
              onMove={onMove}
              onToggleDay={onToggleDay}
              movingId={movingId}
              busyDay={busyDay}
              colorOf={colorOf}
              stickyHeader={
                <div className="flex items-baseline gap-2 pb-1">
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">
                    {labelOf(i)}
                  </span>
                </div>
              }
            />
          </div>
        )
      })}
    </div>
  )
}
