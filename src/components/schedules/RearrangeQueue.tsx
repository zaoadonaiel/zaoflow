'use client'

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { ChevronDown, ChevronUp, GripVertical, Loader2 } from 'lucide-react'
import { timeLabel } from '@/lib/schedule-calendar'
import { zoneById } from '@/lib/timezone'
import type { Article } from '@/types'

/**
 * The queue as a list you drag into the order you want it published in.
 *
 * The same rearranger the client has in their portal, on the team's side of the
 * link: the dates stay exactly where they are and the articles move between
 * them, so a month laid out one a day stays one a day however much it is
 * shuffled. Anything already published, or due out too soon to move, is not in
 * here — there is nothing left to decide about it.
 */

interface Slot {
  at: string
  tz: string | null
}

interface Override {
  order: string[]
  when: Record<string, Slot>
}

/** Only a queued article still in the future can change places. */
function canMove(a: Article): boolean {
  return (
    a.status === 'scheduled' &&
    !!a.scheduled_at &&
    new Date(a.scheduled_at).getTime() > Date.now()
  )
}

/** "Mon, Aug 24" — the day this article lands on, read in its own zone. */
function dayLabel(a: Article): string {
  if (!a.scheduled_at) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zoneById(a.scheduled_tz || 'PST'),
    weekday: 'short', month: 'short', day: 'numeric',
  }).format(new Date(a.scheduled_at))
}

interface Props {
  /** Everything the calendar loaded for this site. */
  articles: Article[]
  /** Reload the calendar behind this list once an order has been saved. */
  onChanged: () => void
  /** Highlights the article the picker was opened for, so it is easy to find. */
  highlightId?: string | null
}

export default function RearrangeQueue({ articles, onChanged, highlightId }: Props) {
  const queue = useMemo(
    () => articles
      .filter(canMove)
      .sort((x, y) => (x.scheduled_at || '').localeCompare(y.scheduled_at || '')),
    [articles]
  )

  // The new order, held locally until the server confirms it. Without this the
  // rows snap back for as long as the save takes, which reads as the drag
  // having failed.
  const [override, setOverride] = useState<Override | null>(null)
  const [saving, setSaving] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)

  // Fresh articles are the truth; whatever was being held stops applying.
  useEffect(() => { setOverride(null) }, [articles])

  const ordered = override
    ? (override.order.map((id) => queue.find((a) => a.id === id)).filter(Boolean) as Article[])
    : queue

  const shown = ordered.map((a) => {
    const slot = override?.when[a.id]
    return slot ? { ...a, scheduled_at: slot.at, scheduled_tz: slot.tz ?? undefined } : a
  })

  /**
   * Deals the queue's own dates onto the articles in their new order — the
   * dates never move, the articles do.
   */
  async function commitOrder(next: Article[]) {
    const slots: Slot[] = ordered
      .map((a) => ({ at: a.scheduled_at as string, tz: a.scheduled_tz ?? null }))
      .sort((x, y) => x.at.localeCompare(y.at))

    const when: Record<string, Slot> = {}
    next.forEach((a, i) => { when[a.id] = slots[i] })

    setOverride({ order: next.map((a) => a.id), when })
    setSaving(true)
    try {
      const res = await fetch('/api/articles/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: next.map((a) => a.id) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not save the new order')
      toast.success('Publication dates updated')
      onChanged()
    } catch (err) {
      // Put the list back rather than leaving dates on screen nothing agreed to.
      setOverride(null)
      toast.error(err instanceof Error ? err.message : 'Could not save the new order')
    } finally {
      setSaving(false)
    }
  }

  function moveBy(index: number, step: number) {
    const to = index + step
    if (to < 0 || to >= ordered.length) return
    const next = [...ordered]
    ;[next[index], next[to]] = [next[to], next[index]]
    commitOrder(next)
  }

  function dropOn(targetId: string) {
    const ids = ordered.map((a) => a.id)
    const from = dragId ? ids.indexOf(dragId) : -1
    const to = ids.indexOf(targetId)
    setDragId(null)
    if (from < 0 || to < 0 || from === to) return
    const next = [...ordered]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    commitOrder(next)
  }

  if (!queue.length) {
    return (
      <p className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">
        Nothing to rearrange — this site has no articles queued for a future date.
      </p>
    )
  }

  if (queue.length === 1) {
    return (
      <p className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">
        Only one article is queued, so there is no order to change yet.
      </p>
    )
  }

  return (
    <div className="h-[58vh] overflow-y-auto pr-1">
      <p className="flex items-center gap-1.5 px-1 pb-3 text-xs text-gray-500 dark:text-gray-400">
        <GripVertical className="w-3.5 h-3.5 text-gray-400" />
        Drag an article, or use the arrows, to change the order it publishes in.
        The dates stay where they are — the articles move between them.
        {saving && <Loader2 className="w-3 h-3 animate-spin text-gray-400" />}
      </p>

      <div className="space-y-2">
        {shown.map((a, i) => (
          <div
            key={a.id}
            draggable={!saving}
            onDragStart={() => setDragId(a.id)}
            onDragOver={(e) => { if (dragId) e.preventDefault() }}
            onDrop={(e) => { e.preventDefault(); dropOn(a.id) }}
            onDragEnd={() => setDragId(null)}
            className={`flex items-stretch gap-3 transition-opacity ${
              dragId === a.id ? 'opacity-60' : ''
            }`}
          >
            {/* The date beside the article rather than inside it: on a queue,
                which day something lands on is read as often as its title. */}
            <div className="flex-shrink-0 w-36 rounded-xl border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 px-3 py-2">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">{dayLabel(a)}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">{timeLabel(a)}</p>
              <div className="flex items-center gap-0.5 mt-1">
                <button
                  type="button"
                  onClick={() => moveBy(i, -1)}
                  disabled={i === 0 || saving}
                  aria-label={`Publish ${a.title} sooner`}
                  title="Publish sooner"
                  className="p-0.5 rounded-md text-gray-400 hover:text-brand-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-25 disabled:hover:bg-transparent"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <GripVertical className="w-4 h-4 text-gray-300 dark:text-gray-600 cursor-grab active:cursor-grabbing" />
                <button
                  type="button"
                  onClick={() => moveBy(i, 1)}
                  disabled={i === ordered.length - 1 || saving}
                  aria-label={`Publish ${a.title} later`}
                  title="Publish later"
                  className="p-0.5 rounded-md text-gray-400 hover:text-brand-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-25 disabled:hover:bg-transparent"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div
              className={`flex-1 min-w-0 flex items-center px-4 py-3 rounded-xl border transition-colors ${
                dragId === a.id
                  ? 'border-brand-400'
                  : a.id === highlightId
                  ? 'border-brand-400 bg-brand-50/50 dark:bg-brand-900/20'
                  : 'border-gray-100 dark:border-gray-700 hover:border-brand-400'
              }`}
            >
              <div className="min-w-0">
                <p className="font-medium text-sm text-gray-900 dark:text-white truncate">{a.title}</p>
                {a.is_paused && (
                  <p className="text-[11px] text-amber-500 mt-0.5">Held — it keeps its place, but will not go out.</p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
