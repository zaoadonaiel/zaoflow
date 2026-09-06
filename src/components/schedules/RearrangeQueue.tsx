'use client'

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { ChevronDown, ChevronUp, GripVertical, Loader2, Sparkles } from 'lucide-react'
import { timeLabel } from '@/lib/schedule-calendar'
import { zoneById } from '@/lib/timezone'
import { money } from '@/lib/format'
import { AVAILABLE_MODELS } from '@/lib/openrouter'
import { IMAGE_GEN_MODELS } from '@/lib/image-gen'
import type { Article, AiUsage } from '@/types'

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

/**
 * A short, human name for an OpenRouter model id.
 *
 * Uses the catalogues we already ship, so "anthropic/claude-haiku-4.5" reads as
 * "Haiku 4.5" — the vendor row is dropped because the row already carries the
 * step (Idea, Article, Image) and the vendor prefix repeats it. Anything not
 * in the catalogues falls back to the last segment, title-cased.
 */
function displayModel(id: string | null | undefined): string {
  if (!id) return '—'
  const known = [...AVAILABLE_MODELS, ...IMAGE_GEN_MODELS].find((m) => m.id === id)
  if (known) return known.name.replace(/^Claude\s+/i, '')
  const tail = id.split('/').pop() || id
  return tail
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** The steps we show and the label they carry, in publish order. */
const BREAKDOWN_STEPS: { key: AiUsage['step']; label: string }[] = [
  { key: 'idea', label: 'Idea' },
  { key: 'article', label: 'Article' },
  { key: 'seo', label: 'SEO' },
  { key: 'image', label: 'Image' },
]

interface BreakdownLine {
  label: string
  model: string
  cost: number | null
}

/**
 * One line per step, with the model actually used and the summed cost for that
 * step. Multiple calls of the same step (retries, several images) collapse into
 * one line — the receipt on the article page is where the itemised story lives.
 */
function summarize(rows: AiUsage[]): { lines: BreakdownLine[]; total: number | null } {
  const byStep = new Map<AiUsage['step'], AiUsage[]>()
  for (const r of rows) {
    const list = byStep.get(r.step) || []
    list.push(r)
    byStep.set(r.step, list)
  }

  const lines: BreakdownLine[] = []
  for (const { key, label } of BREAKDOWN_STEPS) {
    const stepRows = byStep.get(key)
    if (!stepRows?.length) continue
    // Same model most of the time; when it isn't, take the one that produced
    // the priciest call — that's the model the receipt is really about.
    const primary = [...stepRows].sort(
      (a, b) => (b.cost_usd ?? 0) - (a.cost_usd ?? 0),
    )[0]
    const priced = stepRows.filter((r) => r.cost_usd !== null && r.cost_usd !== undefined)
    const cost = priced.length
      ? priced.reduce((n, r) => n + (r.cost_usd ?? 0), 0)
      : null
    lines.push({ label, model: displayModel(primary.model), cost })
  }

  const priced = rows.filter((r) => r.cost_usd !== null && r.cost_usd !== undefined)
  const total = priced.length ? priced.reduce((n, r) => n + (r.cost_usd ?? 0), 0) : null
  return { lines, total }
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
  // Usage rows keyed by article id, so each card can itemise idea/article/image
  // without a fetch of its own. Loaded lazily once the queue is known.
  const [usageByArticle, setUsageByArticle] = useState<Record<string, AiUsage[]>>({})

  // Fresh articles are the truth; whatever was being held stops applying.
  useEffect(() => { setOverride(null) }, [articles])

  // One request for the whole queue's usage. Refetches when the set of ids
  // actually changes — a resort of the same articles must not re-hit the API.
  const queueIdsKey = useMemo(
    () => queue.map((a) => a.id).sort().join(','),
    [queue]
  )
  useEffect(() => {
    if (!queueIdsKey) { setUsageByArticle({}); return }
    const ids = queueIdsKey.split(',').filter(Boolean)
    if (!ids.length) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/articles/usage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ article_ids: ids }),
        })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setUsageByArticle((data.usage || {}) as Record<string, AiUsage[]>)
      } catch {
        // Cost breakdown is a nice-to-have — a failed fetch must not block
        // the drag-to-reorder the queue is actually here for.
      }
    })()
    return () => { cancelled = true }
  }, [queueIdsKey])

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

      <div className="space-y-3">
        {shown.map((a, i) => {
          const rows = usageByArticle[a.id] || []
          const { lines, total } = summarize(rows)
          const isHighlight = a.id === highlightId
          const isDragging = dragId === a.id
          return (
            <div
              key={a.id}
              draggable={!saving}
              onDragStart={() => setDragId(a.id)}
              onDragOver={(e) => { if (dragId) e.preventDefault() }}
              onDrop={(e) => { e.preventDefault(); dropOn(a.id) }}
              onDragEnd={() => setDragId(null)}
              className={`rounded-2xl border transition-colors ${
                isDragging
                  ? 'border-brand-400 opacity-60'
                  : isHighlight
                  ? 'border-brand-400 bg-brand-50/50 dark:bg-brand-900/20'
                  : 'border-gray-100 dark:border-gray-700 hover:border-brand-400'
              } bg-white dark:bg-gray-800 p-4`}
            >
              {/* Head: the date on the left, the move controls on the right.
                  One row rather than a column beside the block, so on a phone
                  the article still gets the full width for its title. */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                    {dayLabel(a)}
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    {timeLabel(a)}
                  </p>
                </div>
                <div className="flex-shrink-0 flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => moveBy(i, -1)}
                    disabled={i === 0 || saving}
                    aria-label={`Publish ${a.title} sooner`}
                    title="Publish sooner"
                    className="p-1 rounded-md text-gray-400 hover:text-brand-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-25 disabled:hover:bg-transparent"
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
                    className="p-1 rounded-md text-gray-400 hover:text-brand-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-25 disabled:hover:bg-transparent"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* The whole title, wrapped, not truncated: on a queue you scan
                  by title, and a cut-off headline is the one thing the row
                  was there to show. */}
              <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white leading-snug break-words">
                {a.title}
              </h3>
              {a.is_paused && (
                <p className="mt-1 text-[11px] text-amber-500">
                  Held — it keeps its place, but will not go out.
                </p>
              )}

              {/* Breakdown: one line per stage, with the model that ran it and
                  what the whole thing cost at the foot. Renders only once the
                  usage fetch has landed a row for this article, so the empty
                  state looks like a skeleton rather than a false zero. */}
              {lines.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
                  <ul className="space-y-1 text-xs">
                    {lines.map((line) => (
                      <li
                        key={line.label}
                        className="flex items-baseline justify-between gap-3 text-gray-600 dark:text-gray-300"
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          <Sparkles className="w-3 h-3 text-gray-400 flex-shrink-0" />
                          <span className="font-medium text-gray-700 dark:text-gray-200">
                            {line.label}:
                          </span>
                          <span className="truncate">{line.model}</span>
                        </span>
                        <span className="flex-shrink-0 tabular-nums text-gray-500 dark:text-gray-400">
                          {line.cost === null ? '—' : `(${money(line.cost)})`}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 pt-2 border-t border-dashed border-gray-100 dark:border-gray-700 flex items-baseline justify-between text-xs">
                    <span className="font-semibold text-gray-900 dark:text-white">Total</span>
                    <span className="font-semibold text-gray-900 dark:text-white tabular-nums">
                      {total === null ? '—' : money(total)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
