'use client'

import { useMemo, useRef, useState } from 'react'
import { CalendarDays, Clock, GripVertical, Loader2, AlertCircle, Pause, Play } from 'lucide-react'
import Modal from './Modal'
import MonthScroller from '@/components/schedules/MonthScroller'
import RearrangeQueue from '@/components/schedules/RearrangeQueue'
import {
  useSiteCalendar, useScheduleActions,
  RING_CLASS, DOT_LABEL, type DayMark,
} from '@/lib/schedule-calendar'
import {
  SCHEDULE_ZONES,
  getZonedParts,
  to24Hour,
  zoneById,
  zonedWallClockToUtc,
  type CivilDate,
} from '@/lib/timezone'

interface Props {
  open: boolean
  onClose: () => void
  articleTitle: string
  /** Existing UTC instant, when the article already has one. */
  currentIso?: string | null
  currentTz?: string | null
  saving?: boolean
  /**
   * What the confirm button says. Defaults to "Save" because on the Schedules
   * page it does save. Anywhere it only records a time for a later commit it
   * must say so — a button labelled Save that saves nothing loses work.
   */
  saveLabel?: string
  /**
   * Marks the days this site already has articles on. Optional — without it
   * the picker is just a picker, with no calendar to load.
   */
  siteId?: string | null
  /** Named in the empty state, so "nothing here" says which site it checked. */
  siteName?: string | null
  /**
   * Called when a drag or a pause in here changed some *other* article's
   * schedule, so the list behind the modal stops showing the old day.
   */
  onCalendarChanged?: () => void
  onSave: (iso: string, tzId: string) => void
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * When an article publishes unless somebody says otherwise.
 *
 * Morning in the site's own zone, which is what a posting schedule means in
 * practice -- and a fixed hour beats "whatever time you happened to open the
 * picker", which is what the seed used to be.
 */
const DEFAULT_HOUR_24 = 9

export default function ScheduleCalendarModal({
  open, onClose, articleTitle, currentIso, currentTz, saving, onSave, saveLabel = 'Save',
  siteId, siteName, onCalendarChanged,
}: Props) {
  // What this site already has on the calendar, so a new slot is picked next to
  // the existing run rather than blindly on top of it.
  const {
    articles,
    byDay,
    loading: calendarLoading,
    error: calendarError,
    reload: reloadCalendar,
  } = useSiteCalendar(siteId, open && !!siteId)

  // Moving an article onto another day, and holding a whole day, are the same
  // two writes the overview calendar makes -- shared so the two cannot drift.
  const { moveArticle, toggleDay, movingId, busyDay } =
    useScheduleActions(reloadCalendar, onCalendarChanged)

  const initialTz = (currentTz as string) || 'PST'

  // Seed every control from the article's existing slot so reopening the modal
  // shows the reading the user picked last time, not today at 12 AM.
  const seed = useMemo(() => {
    const tz = zoneById(initialTz)

    // Nothing scheduled yet: the next 9 AM, not today's. Opening the picker in
    // the afternoon on a nine that has already gone hands you a disabled Save
    // and a red line, which is a worse start than tomorrow morning.
    if (!currentIso) {
      const now = new Date()
      const p = getZonedParts(now, tz)
      const todayAt9 = { year: p.year, month: p.month, day: p.day } as CivilDate
      const passed = zonedWallClockToUtc(todayAt9, DEFAULT_HOUR_24, 0, tz).getTime() <= now.getTime()
      const t = passed
        ? getZonedParts(new Date(now.getTime() + 24 * 60 * 60 * 1000), tz)
        : p
      return {
        date: { year: t.year, month: t.month, day: t.day } as CivilDate,
        hour12: DEFAULT_HOUR_24 % 12 === 0 ? 12 : DEFAULT_HOUR_24 % 12,
        minute: 0,
        meridiem: (DEFAULT_HOUR_24 >= 12 ? 'PM' : 'AM') as 'AM' | 'PM',
      }
    }

    const p = getZonedParts(new Date(currentIso), tz)
    const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12
    return {
      date: { year: p.year, month: p.month, day: p.day } as CivilDate,
      hour12,
      minute: p.minute,
      meridiem: (p.hour >= 12 ? 'PM' : 'AM') as 'AM' | 'PM',
    }
    // Recomputed only when the modal is handed a different article/slot.
  }, [currentIso, initialTz])

  const [selected, setSelected] = useState<CivilDate>(seed.date)
  const [hour12, setHour12] = useState(seed.hour12)
  const [minute, setMinute] = useState(seed.minute)
  const [meridiem, setMeridiem] = useState<'AM' | 'PM'>(seed.meridiem)
  const [tzId, setTzId] = useState(initialTz)
  // The clock is its own modal now: the calendar wants the whole width, and the
  // time is one line you set once, not a wall of buttons beside every month.
  const [showClock, setShowClock] = useState(false)
  // The same room, showing either the months or the queue as a list you drag
  // into order. Two panels rather than two modals: rearranging the queue and
  // picking a day out of it are the same decision seen from two sides.
  const [mode, setMode] = useState<'calendar' | 'rearrange'>('calendar')

  const resultIso = useMemo(
    () => zonedWallClockToUtc(selected, to24Hour(hour12, meridiem), minute, zoneById(tzId)).toISOString(),
    [selected, hour12, minute, meridiem, tzId]
  )
  const isPast = new Date(resultIso).getTime() <= Date.now()

  const today = getZonedParts(new Date(), zoneById(tzId))

  const preview = new Intl.DateTimeFormat('en-US', {
    timeZone: zoneById(tzId),
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(resultIso))

  /** "9:00 AM PST" — what the clock button carries, and what Publishes echoes. */
  const clockLabel = `${hour12}:${pad2(minute)} ${meridiem} ${
    SCHEDULE_ZONES.find((z) => z.id === tzId)?.label ?? tzId
  }`

  // Wide on purpose: a day cell has to be able to hold a title, or the calendar
  // can only say that something is scheduled, not what. The clock that used to
  // sit beside it in a 15rem column is a modal of its own now, so the month has
  // the whole width to spread into.
  return (
    <Modal
      open={open}
      // Escape and the backdrop belong to whichever modal is on top. Without
      // this, dismissing the clock would take the calendar down with it.
      onClose={() => { if (!showClock) onClose() }}
      title={
        <>
          <span className="flex-shrink-0">Schedule article</span>
          {/* The time, next to the name of the thing being scheduled. It reads
              as the current setting and opens the clock when pressed, so the
              slot is never a guess made from the Publishes line alone. */}
          <button
            type="button"
            onClick={() => setShowClock(true)}
            title="Set the time"
            aria-label={`Set the time — currently ${clockLabel}`}
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-200 hover:border-brand-400 hover:text-brand-600 transition-colors"
          >
            <Clock className="w-4 h-4" />
            {clockLabel}
          </button>

          {/* What the slot actually resolves to, up here beside the controls
              that set it. At the foot of a calendar that scrolls it was a
              scroll away every time. */}
          <span className="hidden md:flex flex-col min-w-0 pl-3 border-l border-gray-200 dark:border-gray-700">
            <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
              Publishes
            </span>
            <span
              className={`text-xs font-medium truncate ${
                isPast ? 'text-red-500' : 'text-gray-900 dark:text-white'
              }`}
            >
              {preview}
            </span>
          </span>
        </>
      }
      headerRight={
        <>
          {/* The queue as a list you drag up and down — the same rearranger
              the client has on their end of the link. */}
          <button
            type="button"
            onClick={() => setMode((m) => (m === 'rearrange' ? 'calendar' : 'rearrange'))}
            aria-pressed={mode === 'rearrange'}
            title={mode === 'rearrange'
              ? 'Back to the calendar'
              : 'Drag the queue into the order it publishes in'}
            className={`h-10 px-4 rounded-xl border text-sm font-medium inline-flex items-center gap-1.5 transition-colors ${
              mode === 'rearrange'
                ? 'border-brand-500 bg-brand-600/10 text-brand-600 dark:text-brand-400'
                : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-brand-400 hover:text-brand-600'
            }`}
          >
            {mode === 'rearrange'
              ? <><CalendarDays className="w-4 h-4" /> Calendar</>
              : <><GripVertical className="w-4 h-4" /> Rearrange</>}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isPast || saving}
            onClick={() => onSave(resultIso, tzId)}
            className="h-10 px-6 rounded-xl bg-[#39ff14] text-gray-900 text-sm font-bold hover:bg-[#2ee600] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saveLabel}
          </button>
        </>
      }
      maxWidth="max-w-6xl"
    >
      {/* Mounted only while open, so it seeds from the current slot each time
          rather than holding whatever was spun on the dial and abandoned. */}
      {showClock && (
        <ClockModal
          hour12={hour12}
          minute={minute}
          meridiem={meridiem}
          tzId={tzId}
          onCancel={() => setShowClock(false)}
          onApply={(v) => {
            setHour12(v.hour12)
            setMinute(v.minute)
            setMeridiem(v.meridiem)
            setTzId(v.tzId)
            setShowClock(false)
          }}
        />
      )}

      <div className="flex items-baseline justify-between gap-3 mb-2">
        <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-1 min-w-0">{articleTitle}</p>
        {isPast && (
          <p className="text-xs text-red-500 flex-shrink-0">
            That time has already passed — pick a later one.
          </p>
        )}
      </div>

      {/* Too narrow for the header's readout: it says the same thing here. */}
      <p className="md:hidden text-xs mb-2 text-gray-500 dark:text-gray-400">
        Publishes{' '}
        <span className={`font-medium ${isPast ? 'text-red-500' : 'text-gray-900 dark:text-white'}`}>
          {preview}
        </span>
      </p>

      {mode === 'rearrange' ? (
        <RearrangeQueue
          articles={articles}
          onChanged={() => { reloadCalendar(); onCalendarChanged?.() }}
        />
      ) : (
        <div className="min-w-0">
          {/* Every month in one scroll, growing at whichever end is reached —
              September is a scroll away, not five presses of an arrow. */}
          <MonthScroller
            start={selected}
            byDay={byDay}
            today={today}
            selected={selected}
            onPickDay={setSelected}
            onMove={moveArticle}
            onToggleDay={toggleDay}
            movingId={movingId}
            busyDay={busyDay}
          />

          {siteId && calendarError ? (
            <p className="flex items-start gap-1.5 mt-2 text-[11px] text-red-600 dark:text-red-400">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>
                {calendarError} — the days above are unmarked because nothing could be read,
                not because nothing is there.{' '}
                <button
                  type="button"
                  onClick={reloadCalendar}
                  className="underline underline-offset-2 hover:text-red-700 dark:hover:text-red-300"
                >
                  Retry
                </button>
              </span>
            </p>
          ) : siteId && calendarLoading ? (
            <p className="flex items-center gap-1.5 mt-2 text-[11px] text-gray-400 dark:text-gray-500">
              <Loader2 className="w-3 h-3 animate-spin" />
              Loading what this site has published and queued…
            </p>
          ) : byDay.size > 0 ? (
            <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-400 dark:text-gray-500">
              {/* Rings, because rings are what the grid draws now — a legend of
                  dots would be explaining a mark that is no longer up there. */}
              {(['scheduled', 'paused', 'published'] as DayMark[]).map((m) => (
                <span key={m} className="flex items-center gap-1.5">
                  <span className={`w-3.5 h-3.5 rounded-full ${RING_CLASS[m]}`} /> {DOT_LABEL[m]}
                </span>
              ))}
              <span className="flex items-center gap-1.5">
                <Pause className="w-3 h-3" /> / <Play className="w-3 h-3" /> Hold a day
              </span>
              <span className="ml-auto">Drag a title onto another day to move it</span>
            </div>
          ) : siteId ? (
            <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
              {siteName ? `${siteName} has` : 'This site has'} nothing published or scheduled
              yet, so no days are marked. Drafts do not appear here until they are scheduled
              or published.
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
              Pick a site to see what it has already published and what is queued.
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}

/** Where a number sits on the dial: index 0 at the top, going clockwise. */
function dialPoint(index: number, radius: number) {
  const angle = (index * 30 - 90) * (Math.PI / 180)
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
}

/** Dial geometry, in px. One place, so the hand and the numbers agree. */
const DIAL = { size: 268, ring: 106, hand: 22 }

/**
 * The clock, on its own.
 *
 * Hour, minute, meridiem and zone were a column of buttons pinned beside every
 * month. They are set once and looked at rarely, so they live behind the clock
 * in the header now and the calendar has the width back.
 *
 * A dial rather than a list: an hour is a position on a face, and the hand you
 * drag round it is the control everyone already knows from the phone in their
 * pocket. Picking an hour hands you straight to the minutes, because that is
 * always the next thing — there is no second press to remember.
 *
 * Its own draft, committed on OK: the calendar behind must not follow the hand
 * round the dial, and Cancel has to leave the slot exactly as it was found.
 */
function ClockModal({
  hour12: initialHour, minute: initialMinute, meridiem: initialMeridiem, tzId: initialZone,
  onCancel, onApply,
}: {
  hour12: number
  minute: number
  meridiem: 'AM' | 'PM'
  tzId: string
  onCancel: () => void
  onApply: (v: { hour12: number; minute: number; meridiem: 'AM' | 'PM'; tzId: string }) => void
}) {
  const [hour12, setHour12] = useState(initialHour)
  const [minute, setMinute] = useState(initialMinute)
  const [meridiem, setMeridiem] = useState<'AM' | 'PM'>(initialMeridiem)
  const [tzId, setTzId] = useState(initialZone)
  /** Which half of the reading the dial is currently setting. */
  const [mode, setMode] = useState<'hour' | 'minute'>('hour')
  const [dragging, setDragging] = useState(false)
  const dial = useRef<HTMLDivElement>(null)

  /** The angle from twelve o'clock, clockwise, of a point in the dial. */
  function valueAt(clientX: number, clientY: number): number | null {
    const el = dial.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    const x = clientX - r.left - r.width / 2
    const y = clientY - r.top - r.height / 2
    let deg = (Math.atan2(x, -y) * 180) / Math.PI
    if (deg < 0) deg += 360

    if (mode === 'hour') {
      const i = Math.round(deg / 30) % 12
      return i === 0 ? 12 : i
    }
    // Minutes land on the minute, not the nearest five: the labels are every
    // five because twelve of them fit round a face, not because 9:07 is
    // something the calendar refuses to hold.
    return Math.round(deg / 6) % 60
  }

  function apply(clientX: number, clientY: number) {
    const v = valueAt(clientX, clientY)
    if (v === null) return
    if (mode === 'hour') setHour12(v)
    else setMinute(v)
  }

  function onPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    apply(e.clientX, e.clientY)
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging) return
    apply(e.clientX, e.clientY)
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!dragging) return
    setDragging(false)
    apply(e.clientX, e.clientY)
    // Straight on to the minutes, the way a phone does it. Nothing else is
    // ever the next thing after an hour.
    if (mode === 'hour') setMode('minute')
  }

  /** Arrow keys, for anyone not pointing at the thing. */
  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1
      : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1
      : 0
    if (!step) return
    e.preventDefault()
    if (mode === 'hour') setHour12((h) => ((h - 1 + step + 12) % 12) + 1)
    else setMinute((m) => (m + step + 60) % 60)
  }

  // Where the hand points: an hour is one of twelve positions, a minute is one
  // of sixty on the same circle.
  const handIndex = mode === 'hour' ? hour12 % 12 : minute / 5
  const hand = dialPoint(handIndex, DIAL.ring)

  const half = DIAL.size / 2
  const readoutClass = (active: boolean) =>
    `flex-1 h-16 rounded-xl text-4xl font-light tabular-nums transition-colors ${
      active
        ? 'bg-brand-600/15 text-brand-600 dark:text-brand-400 ring-1 ring-brand-500'
        : 'bg-gray-100 dark:bg-gray-900/60 text-gray-900 dark:text-white hover:bg-gray-200 dark:hover:bg-gray-900'
    }`

  return (
    <Modal open onClose={onCancel} title="Select time" maxWidth="max-w-sm">
      {/* The reading, and the two halves of it as the way to switch which one
          the dial is setting — the same place the number is already being
          read from. */}
      <div className="flex items-stretch gap-2 mb-6">
        <button type="button" onClick={() => setMode('hour')} className={readoutClass(mode === 'hour')} aria-label={`Hour, ${hour12}`}>
          {pad2(hour12)}
        </button>
        <span className="self-center text-3xl font-light text-gray-400">:</span>
        <button type="button" onClick={() => setMode('minute')} className={readoutClass(mode === 'minute')} aria-label={`Minute, ${pad2(minute)}`}>
          {pad2(minute)}
        </button>

        <div className="flex flex-col w-14 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
          {(['AM', 'PM'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMeridiem(m)}
              aria-pressed={meridiem === m}
              className={`flex-1 text-sm font-semibold transition-colors ${
                meridiem === m
                  ? 'bg-brand-600 text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* The face. One set of pointer handlers on the dial rather than a click
          on each number: the hand is dragged as often as it is tapped, and a
          number that handled its own click would fire for the mode the dial
          had already moved on from. */}
      <div
        ref={dial}
        role="slider"
        tabIndex={0}
        aria-label={mode === 'hour' ? 'Hour' : 'Minute'}
        aria-valuemin={mode === 'hour' ? 1 : 0}
        aria-valuemax={mode === 'hour' ? 12 : 59}
        aria-valuenow={mode === 'hour' ? hour12 : minute}
        aria-valuetext={mode === 'hour' ? `${hour12} o'clock` : `${pad2(minute)} minutes`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={onKeyDown}
        style={{ width: DIAL.size, height: DIAL.size }}
        className="relative mx-auto rounded-full bg-gray-100 dark:bg-gray-900/60 touch-none select-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        {/* Hand and hub, under the numbers so the one it lands on stays legible. */}
        <svg width={DIAL.size} height={DIAL.size} className="absolute inset-0 pointer-events-none">
          <line
            x1={half} y1={half}
            x2={half + hand.x} y2={half + hand.y}
            className="stroke-brand-600"
            strokeWidth={2}
          />
          <circle cx={half + hand.x} cy={half + hand.y} r={DIAL.hand} className="fill-brand-600" />
          <circle cx={half} cy={half} r={4} className="fill-brand-600" />
        </svg>

        {Array.from({ length: 12 }).map((_, i) => {
          // Twelve at the top, then clockwise; minutes count in fives round the
          // same twelve positions.
          const label = mode === 'hour' ? (i === 0 ? 12 : i) : pad2(i * 5)
          const value = mode === 'hour' ? (i === 0 ? 12 : i) : i * 5
          const active = mode === 'hour' ? hour12 === value : minute === value
          const p = dialPoint(i, DIAL.ring)
          return (
            <span
              key={i}
              style={{ left: half + p.x, top: half + p.y }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full text-base tabular-nums pointer-events-none ${
                active ? 'text-white font-semibold' : 'text-gray-700 dark:text-gray-200'
              }`}
            >
              {label}
            </span>
          )
        })}
      </div>

      {/* The zone, under the face. It is part of the time — 9 AM is not a slot
          until it says 9 AM where. */}
      <div className="grid grid-cols-4 gap-1.5 mt-6">
        {SCHEDULE_ZONES.map((z) => (
          <button
            key={z.id}
            type="button"
            onClick={() => setTzId(z.id)}
            aria-pressed={tzId === z.id}
            className={`h-10 rounded-xl text-xs font-medium border transition-colors ${
              tzId === z.id
                ? 'bg-brand-600 border-brand-600 text-white'
                : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-brand-400'
            }`}
          >
            {z.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2 mt-5">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 h-11 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onApply({ hour12, minute, meridiem, tzId })}
          className="flex-1 h-11 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700"
        >
          OK
        </button>
      </div>
    </Modal>
  )
}
