'use client'

import { useState, useMemo, useCallback } from 'react'
import {
  ChevronLeft, ChevronRight, Loader2, LayoutGrid, List, GripVertical,
  Pause, Play,
} from 'lucide-react'
import Modal from '@/components/ui/Modal'
import MonthGrid from './MonthGrid'
import { getZonedParts, zoneById } from '@/lib/timezone'
import { ALL_SITES } from '@/lib/site-filter'
import {
  useSiteCalendar, civilKey, timeLabel, isMovable, markOf, partsOfKey,
  useScheduleActions,
  DOT_CLASS, DOT_CLASS_SM, RING_CLASS, DOT_LABEL, type DayMark,
} from '@/lib/schedule-calendar'
import { siteColors } from '@/lib/site-colors'
import type { Article, Site } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  siteId: string
  siteName?: string
  /**
   * Every site, so a calendar showing all of them can give each one a colour.
   * Left out, or with one site on screen, nothing is coloured — there is
   * nothing to tell apart.
   */
  sites?: Site[]
  /** Lets the page behind this modal pick up a move made in here. */
  onChanged?: () => void
}

/** "Wed" for a day key, so the list reads like a diary rather than a table. */
function weekdayOf(key: string): string {
  const { year, month, day } = partsOfKey(key)
  return new Date(Date.UTC(year, month - 1, day))
    .toLocaleString('en-US', { weekday: 'short', timeZone: 'UTC' })
}

export default function ScheduleCalendarOverview({
  open, onClose, siteId, siteName, sites = [], onChanged,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  // The grid is for seeing the shape of a month; the list is for changing it,
  // because a day you can drop an article onto has to be big enough to aim at.
  const [mode, setMode] = useState<'grid' | 'list'>('grid')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [overKey, setOverKey] = useState<string | null>(null)

  const today = getZonedParts(new Date(), zoneById('PST'))
  const [view, setView] = useState({ year: today.year, month: today.month })

  const { articles, byDay, queuedCount, loading, error, reload } = useSiteCalendar(siteId, open)

  // One colour per site, but only while more than one is on screen. Looking at
  // a single site, every row would be the same colour and it would be saying
  // nothing.
  const showColors = siteId === ALL_SITES && sites.length > 1
  const colors = useMemo(() => siteColors(sites), [sites])
  const colorOf = useCallback(
    (a: Article) => (showColors ? colors.get(a.site_id) : undefined),
    [showColors, colors]
  )
  const nameOf = useCallback(
    (a: Article) => a.sites?.name || sites.find((s) => s.id === a.site_id)?.name || '',
    [sites]
  )

  // Only the sites this month actually holds, so the key does not list five
  // sites when the month has articles from two.
  const legend = useMemo(() => {
    if (!showColors) return []
    const seen = new Map<string, string>()
    for (const a of articles) {
      if (!seen.has(a.site_id)) seen.set(a.site_id, nameOf(a))
    }
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name, color: colors.get(id) }))
      .filter((r) => !!r.color)
  }, [showColors, articles, colors, nameOf])

  const total = new Date(Date.UTC(view.year, view.month, 0)).getUTCDate()
  const monthLabel = new Date(Date.UTC(view.year, view.month - 1, 1)).toLocaleString('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  })
  const todayKey = civilKey(today.year, today.month, today.day)

  function shift(delta: number) {
    const d = new Date(Date.UTC(view.year, view.month - 1 + delta, 1))
    setView({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 })
    setSelected(null)
  }

  // Moving an article onto another day and holding a whole day are the same
  // two writes the picker's calendar makes -- shared so the two cannot drift.
  const { moveArticle, toggleDay, movingId, busyDay } = useScheduleActions(reload, onChanged)

  function handleDrop(e: React.DragEvent, key: string) {
    e.preventDefault()
    const id = draggingId || e.dataTransfer.getData('text/plain')
    setDraggingId(null)
    setOverKey(null)
    const article = articles.find((a) => a.id === id)
    if (article) moveArticle(article, key)
  }

  const selectedPosts = selected ? byDay.get(selected) || [] : []

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={siteName ? `Publishing calendar — ${siteName}` : 'Publishing calendar'}
      maxWidth="max-w-6xl"
    >
      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
      ) : error ? (
        <div className="py-12 text-center">
          <p className="text-sm font-medium text-gray-900 dark:text-white">Could not load the calendar</p>
          <p className="text-xs text-gray-500 mt-1">{error}</p>
          <button onClick={reload} className="mt-4 bg-brand-600 text-white px-4 py-2 rounded-xl text-sm font-medium">
            Try again
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-1">
              <button
                onClick={() => shift(-1)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                aria-label="Previous month"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-semibold text-gray-900 dark:text-white min-w-[9rem] text-center">
                {monthLabel}
              </span>
              <button
                onClick={() => shift(1)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                aria-label="Next month"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-0.5 rounded-lg border border-gray-200 dark:border-gray-700 p-0.5">
              {([
                ['grid', LayoutGrid, 'Month grid'],
                ['list', List, 'Day list — drag to move'],
              ] as const).map(([value, Icon, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => { setMode(value); setSelected(null) }}
                  title={label}
                  aria-label={label}
                  aria-pressed={mode === value}
                  className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
                    mode === value
                      ? 'bg-brand-600 text-white'
                      : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </button>
              ))}
            </div>
          </div>

          {mode === 'grid' ? (
          <>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
            The same month you schedule an article in. Drag a title onto another
            day to move it — the time it publishes at goes with it. The hold on a
            day stops everything queued on it.
          </p>
          <MonthGrid
            view={{ ...view, day: 1 }}
            byDay={byDay}
            today={today}
            monthLabel={monthLabel}
            selected={selected ? { ...partsOfKey(selected) } : null}
            onPickDay={(cell) => {
              const key = civilKey(cell.year, cell.month, cell.day)
              setSelected((s) => (s === key ? null : key))
            }}
            onMove={moveArticle}
            onToggleDay={toggleDay}
            movingId={movingId}
            busyDay={busyDay}
            colorOf={colorOf}
          />
          </>
          ) : (
          <>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
              Drag an article onto any day. It keeps the time it publishes at —
              only the date moves.
              {showColors && ' Each site has its own colour.'}
            </p>
            {/* Every day of the month, empty ones included — an empty day is
                the whole point: it is what you drag an article onto. */}
            <div className="rounded-xl border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700 max-h-[26rem] overflow-y-auto">
              {Array.from({ length: total }).map((_, i) => {
                const day = i + 1
                const key = civilKey(view.year, view.month, day)
                const posts = byDay.get(key) || []
                const isToday = key === todayKey
                const isOver = overKey === key

                return (
                  <div
                    key={key}
                    onDragOver={(e) => {
                      if (!draggingId) return
                      e.preventDefault()
                      setOverKey(key)
                    }}
                    onDragLeave={() => setOverKey((k) => (k === key ? null : k))}
                    onDrop={(e) => handleDrop(e, key)}
                    className={`flex gap-3 px-3 py-2 transition-colors ${
                      isOver
                        ? 'bg-brand-50 dark:bg-brand-900/20'
                        : isToday
                          ? 'bg-gray-50 dark:bg-gray-700/30'
                          : ''
                    }`}
                  >
                    <div className="w-20 shrink-0 pt-1">
                      <p className={`text-xs font-semibold ${
                        isToday ? 'text-brand-600 dark:text-brand-400' : 'text-gray-700 dark:text-gray-200'
                      }`}>
                        {weekdayOf(key)} {day}
                      </p>
                      {isToday && <p className="text-[10px] text-brand-500">Today</p>}
                    </div>

                    <div className="flex-1 min-w-0 space-y-1">
                      {posts.length === 0 ? (
                        <p className={`text-xs italic py-1 ${
                          isOver
                            ? 'text-brand-600 dark:text-brand-400'
                            : 'text-gray-300 dark:text-gray-600'
                        }`}>
                          {isOver ? 'Drop to publish this day' : 'Nothing scheduled'}
                        </p>
                      ) : (
                        posts.map((p) => {
                          const movable = isMovable(p)
                          return (
                            <div
                              key={p.id}
                              draggable={movable && !movingId}
                              onDragStart={(e) => {
                                setDraggingId(p.id)
                                e.dataTransfer.setData('text/plain', p.id)
                                e.dataTransfer.effectAllowed = 'move'
                              }}
                              onDragEnd={() => { setDraggingId(null); setOverKey(null) }}
                              title={movable
                                ? 'Drag onto another day — the time stays the same'
                                : 'Published articles cannot be moved'}
                              className={`relative flex items-center gap-2 rounded-lg border px-2 py-1.5 bg-white dark:bg-gray-800 overflow-hidden ${
                                draggingId === p.id
                                  ? 'border-brand-400 opacity-50'
                                  : 'border-gray-100 dark:border-gray-700'
                              } ${movable ? 'cursor-grab active:cursor-grabbing' : 'opacity-70'}`}
                            >
                              {/* Whose article this is, down the left edge. On
                                  All sites the list is one long run of rows,
                                  and the colour sorts them by eye before a
                                  single name has been read. */}
                              {colorOf(p) && (
                                <span className={`absolute left-0 top-0 bottom-0 w-1 ${colorOf(p)!.bar}`} />
                              )}
                              {movingId === p.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400 shrink-0" />
                              ) : movable ? (
                                <GripVertical className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 shrink-0" />
                              ) : (
                                <span className={`w-2 h-2 rounded-full shrink-0 ml-1 mr-0.5 ${DOT_CLASS_SM[markOf(p)]}`} />
                              )}
                              <span className="flex-1 min-w-0">
                                <span className="block text-sm text-gray-900 dark:text-white truncate">
                                  {p.title}
                                </span>
                                <span className="block text-xs text-gray-400">
                                  {timeLabel(p)}
                                  {colorOf(p) && (
                                    <span className={`ml-2 px-1.5 rounded border text-[10px] font-medium ${colorOf(p)!.chip}`}>
                                      {nameOf(p)}
                                    </span>
                                  )}
                                  {p.status === 'published' ? (
                                    <span className="text-gray-500 dark:text-gray-400 ml-2 font-medium">Published</span>
                                  ) : p.is_paused ? (
                                    <span className="text-amber-500 ml-2 font-medium">Paused</span>
                                  ) : null}
                                </span>
                              </span>
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
          )}

          {/* Which colour is which site, listed only for the sites this month
              actually holds. */}
          {legend.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-xs text-gray-500 dark:text-gray-400">
              {legend.map((l) => (
                <span key={l.id} className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-sm ${l.color!.dot}`} />
                  {l.name || 'Unnamed site'}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
            {/* Rings in the grid, so rings here. A legend of dots would be
                explaining a mark that is no longer up there. */}
            {(['scheduled', 'paused', 'published'] as DayMark[]).map((m) => (
              <span key={m} className="flex items-center gap-1.5">
                <span className={`w-3.5 h-3.5 rounded-full ${
                  mode === 'grid' ? RING_CLASS[m] : DOT_CLASS[m]
                }`} /> {DOT_LABEL[m]}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <Pause className="w-3 h-3 text-gray-400" /> / <Play className="w-3 h-3 text-amber-500" /> Hold a day
            </span>
            <span className="ml-auto">{queuedCount} queued</span>
          </div>

          {/* The day you opened, spelled out -- and the handle grid mode was
              missing. The cells are too small to hold a title you could aim
              at, so the title you drag lives here and the day you drop it on
              is up in the grid. */}
          {mode === 'grid' && selectedPosts.length > 0 && (
            <div className="mt-4 rounded-xl border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700 max-h-52 overflow-y-auto">
              {selectedPosts.map((p) => {
                const movable = isMovable(p)
                return (
                <div
                  key={p.id}
                  draggable={movable && !movingId}
                  onDragStart={(e) => {
                    setDraggingId(p.id)
                    e.dataTransfer.setData('text/plain', p.id)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragEnd={() => { setDraggingId(null); setOverKey(null) }}
                  title={movable
                    ? 'Drag onto a day above — the time stays the same'
                    : 'Published articles cannot be moved'}
                  className={`relative flex items-center gap-2 px-4 py-2.5 ${
                    movable ? 'cursor-grab active:cursor-grabbing' : ''
                  } ${draggingId === p.id ? 'opacity-40' : ''}`}
                >
                  {colorOf(p) && (
                    <span className={`absolute left-0 top-0 bottom-0 w-1 ${colorOf(p)!.bar}`} />
                  )}
                  {movingId === p.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400 shrink-0" />
                  ) : movable ? (
                    <GripVertical className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 shrink-0" />
                  ) : (
                    <span className={`w-2 h-2 rounded-full shrink-0 ml-1 mr-0.5 ${DOT_CLASS_SM[markOf(p)]}`} />
                  )}
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-gray-900 dark:text-white truncate">{p.title}</span>
                    <span className="block text-xs text-gray-400 mt-0.5">
                      {timeLabel(p)}
                      {p.status === 'published' ? (
                        <span className="text-gray-500 dark:text-gray-400 ml-2 font-medium">Published</span>
                      ) : p.is_paused ? (
                        <span className="text-amber-500 ml-2 font-medium">Paused</span>
                      ) : null}
                    </span>
                  </span>
                </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
