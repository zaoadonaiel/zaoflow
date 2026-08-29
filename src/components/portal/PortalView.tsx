'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  LayoutGrid, List, CalendarDays, ArrowLeft, Loader2, Clock, Check, X, Pencil, Save,
  GripVertical, ChevronUp, ChevronDown,
} from 'lucide-react'
import { CLIENT_LABEL, type RevisionState } from '@/lib/portal'
import type { SeoCheck } from '@/lib/seo-checks'
import { formatInZone, getZonedParts, zoneById, zoneLabel } from '@/lib/timezone'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import ArticleEditor from '@/components/articles/ArticleEditor'
import PortalCalendar from './PortalCalendar'
import ActivityLog from '@/components/collab/ActivityLog'
import DraftList from '@/components/collab/DraftList'
import ApprovalToggle from '@/components/collab/ApprovalToggle'
import CollabThread, { type ThreadMessage } from '@/components/collab/CollabThread'
import { versionHtml } from '@/lib/diff-html'
import {
  draftLabel, EDIT_CLASS, type ArticleDraft, type CollabEvent, type AuthorSide,
} from '@/lib/collab'

export interface PortalArticle {
  id: string
  title: string
  snippet: string
  content: string
  status: string
  scheduled_at?: string | null
  scheduled_tz?: string | null
  published_at?: string | null
  featured_image_url?: string | null
  seo: SeoCheck[]
  commentable: boolean
  /** Approved is the resting state; paused stops the schedule until undone. */
  is_paused: boolean
  state: RevisionState
  revised_at?: string | null
  comments: ThreadMessage[]
  drafts: ArticleDraft[]
  events: CollabEvent[]
}

interface Props {
  token: string
  clientName?: string | null
  siteName?: string | null
  articles: PortalArticle[]
  onRefresh: () => void
}

/**
 * The date of an article, broken into the pieces a date block shows.
 *
 * Read in the article's own zone: a client scheduling for 9 AM Hawaii wants to
 * see 9 AM, not whatever that instant happens to be where their browser is.
 */
function dateParts(iso: string, zoneId: string) {
  const tz = zoneById(zoneId)
  const at = new Date(iso)
  const on = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }).format(at)

  return {
    day: on({ month: 'short', day: 'numeric' }),
    year: on({ year: 'numeric' }),
    time: on({ hour: 'numeric', minute: '2-digit', hour12: true }),
  }
}

/**
 * The date, given a block of its own beside the article.
 *
 * On a schedule the date is the thing being read — which article lands on
 * which day — so it is not a line of small print under the title. It is set
 * large, and the year small under it, because within a list you are nearly
 * always comparing days inside one year.
 */
function DateBlock({
  article,
  children,
}: {
  article: PortalArticle
  /** Reorder controls, when the article can be moved. */
  children?: React.ReactNode
}) {
  const published = article.status === 'published'
  const iso = published ? article.published_at : article.scheduled_at
  const parts = iso ? dateParts(iso, article.scheduled_tz || 'PST') : null
  const zone = zoneLabel(article.scheduled_tz || 'PST')

  return (
    <div className="flex-shrink-0 w-32 sm:w-44 rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-4 flex flex-col">
      <div className="h-5 flex items-center justify-start">{children}</div>

      {parts ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <span className="text-[11px] font-semibold text-gray-400 dark:text-gray-500">
            {published ? 'Published' : 'Scheduled'}
          </span>
          <span className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white whitespace-nowrap">
            {parts.day}
          </span>
          <span className="text-xs font-medium text-gray-400 dark:text-gray-500">{parts.year}</span>
          <span className="mt-2 text-sm font-medium text-gray-700 dark:text-gray-200 whitespace-nowrap">
            {parts.time} {zone}
          </span>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-center">
          <span className="text-sm font-medium text-gray-400 dark:text-gray-500">Not scheduled</span>
        </div>
      )}
    </div>
  )
}

/** "Published 08/09/2026 12:50 PM PST" — the tag a live article carries. */
function PublishedTag({ at, tz }: { at?: string | null; tz?: string | null }) {
  if (!at) return null
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
      Published {formatInZone(at, tz || 'PST', 'numeric')}
    </span>
  )
}

function StateBadge({ state, revisedAt }: { state: RevisionState; revisedAt?: string | null }) {
  const styles: Record<RevisionState, string> = {
    // Neutral, not green — nothing has been agreed to yet.
    unseen: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300',
    approved: 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400',
    in_progress: 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400',
    revision_complete: 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400',
  }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${styles[state]}`}>
      {CLIENT_LABEL[state]}
      {state === 'revision_complete' && revisedAt && (
        <span className="font-normal opacity-75">
          · Revised {format(new Date(revisedAt), 'MM/dd/yyyy h:mm a')}
        </span>
      )}
    </span>
  )
}

/**
 * Yoast/SEO fields with a pass mark each. Green when the field is filled in and
 * within its character limit, red when it is missing or over.
 */
function SeoPanel({ checks }: { checks: SeoCheck[] }) {
  if (!checks.length) return null

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 mt-5">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">SEO details</h2>

      <ul className="space-y-3">
        {checks.map((c) => (
          <li key={c.label} className="flex items-start gap-3">
            {c.pass ? (
              <span
                className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-[#39ff14]/15 flex items-center justify-center"
                aria-label="Meets the character limit"
              >
                <Check
                  className="w-3.5 h-3.5 text-[#39ff14]"
                  strokeWidth={3}
                  style={{ filter: 'drop-shadow(0 0 3px rgba(57,255,20,0.9))' }}
                />
              </span>
            ) : (
              <span
                className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center"
                aria-label="Does not meet the character limit"
              >
                <X className="w-3 h-3 text-white" strokeWidth={3.5} />
              </span>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium text-gray-900 dark:text-white">{c.label}</p>
                <span
                  className={`text-xs font-mono flex-shrink-0 ${
                    c.pass ? 'text-gray-400' : 'text-red-500'
                  }`}
                >
                  {c.length}/{c.max}
                </span>
              </div>
              {c.value ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 break-words mt-0.5">{c.value}</p>
              ) : (
                <p className="text-sm text-gray-400 italic mt-0.5">Not set</p>
              )}
              {c.note && c.value && (
                <p className="text-xs text-red-500 mt-0.5">{c.note}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Every month, or one of them — the value behind the month tags. */
const ALL_MONTHS = 'all'

/**
 * "2026-08" — the month an article belongs to, read in its own timezone so a
 * late-evening PST article is not tagged to the following month.
 *
 * Published articles are filed under the day they went live, everything else
 * under the day it is due.
 */
function instantOf(a: PortalArticle): string | null {
  return (a.status === 'published' ? a.published_at : a.scheduled_at) || null
}

function monthKey(a: PortalArticle): string | null {
  const iso = instantOf(a)
  if (!iso) return null
  const p = getZonedParts(new Date(iso), zoneById(a.scheduled_tz || 'PST'))
  return `${p.year}-${String(p.month).padStart(2, '0')}`
}

/** "2026-08" -> "Aug 2026", or just "Aug" when a year row already says which. */
function monthLabel(key: string, withYear = true): string {
  const [year, month] = key.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', {
    month: 'short',
    ...(withYear ? { year: 'numeric' as const } : {}),
    timeZone: 'UTC',
  })
}

/** "2026-08" -> "2026" */
function yearOf(monthKey: string): string {
  return monthKey.split('-')[0]
}

/** A publication date and the zone it was set in. The two travel together. */
interface Slot {
  at: string
  tz: string | null
}

interface Override {
  /** Queue article ids, in the order the client just put them in. */
  order: string[]
  /** The date each of them lands on as a result. */
  when: Record<string, Slot>
}

/**
 * Whether an article can still change places.
 *
 * Published articles are history. So, in practice, is one whose slot has
 * already come round: it is due out, and dealing it a later date would be
 * undone the moment the queue runs.
 */
function isMovable(a: PortalArticle): boolean {
  return (
    a.status !== 'published' &&
    !!a.scheduled_at &&
    new Date(a.scheduled_at).getTime() > Date.now()
  )
}

export default function PortalView({ token, clientName, siteName, articles, onRefresh }: Props) {
  const [view, setView] = useState<'list' | 'grid'>('list')
  // The calendar is a modal rather than a third view: it answers "what lands
  // when" across every month at once, which the month tags below cannot.
  const [showCalendar, setShowCalendar] = useState(false)
  // Defaults to what is coming up, which is what the portal is for. 'all' is
  // how a month shows its published history and its queue side by side.
  const [tab, setTab] = useState<'all' | 'scheduled' | 'published'>('scheduled')
  const [month, setMonth] = useState<string>(ALL_MONTHS)
  const [year, setYear] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  // Which version is being read; null is the article as it stands.
  const [versionId, setVersionId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  // Held apart from the article so an autosave landing mid-edit cannot
  // overwrite what is being typed.
  const [editHtml, setEditHtml] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  // The reordered queue, held locally until the server confirms it. Without
  // this the rows would snap back to their old order for as long as the save
  // takes, which reads as the drag having failed.
  const [override, setOverride] = useState<Override | null>(null)
  const [saving, setSaving] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)

  // Fresh articles are the truth; whatever was being held stops applying.
  useEffect(() => { setOverride(null) }, [articles])

  const open = articles.find((a) => a.id === openId)

  const inTab = useMemo(
    () => articles.filter((a) =>
      tab === 'all' ? true
        : tab === 'published' ? a.status === 'published'
        : a.status !== 'published'
    ),
    [articles, tab]
  )

  // Newest month first, with how many articles each holds.
  const allMonths = useMemo(() => {
    const counts = new Map<string, number>()
    for (const a of inTab) {
      const k = monthKey(a)
      if (k) counts.set(k, (counts.get(k) || 0) + 1)
    }
    return [...counts.entries()]
      .sort((x, y) => y[0].localeCompare(x[0]))
      .map(([key, count]) => ({ key, count }))
  }, [inTab])

  // A portal accumulates, so a flat row of every month it has ever held stops
  // being scannable after a year. Years appear only once there are two of them.
  const years = useMemo(
    () => [...new Set(allMonths.map((m) => yearOf(m.key)))].sort((x, y) => y.localeCompare(x)),
    [allMonths]
  )
  const showYears = years.length > 1
  // Falls back to the newest year rather than an empty page when the chosen one
  // has nothing in the current tab.
  const activeYear = year && years.includes(year) ? year : years[0] ?? null

  const months = showYears && activeYear
    ? allMonths.filter((m) => yearOf(m.key) === activeYear)
    : allMonths

  // Switching tabs or years can strip the chosen month out of the list — fall
  // back to showing everything rather than an empty page with a tag selected.
  const activeMonth = months.some((m) => m.key === month) ? month : ALL_MONTHS

  const filtered = activeMonth === ALL_MONTHS
    ? (showYears && activeYear
        ? inTab.filter((a) => { const k = monthKey(a); return k && yearOf(k) === activeYear })
        : inTab)
    : inTab.filter((a) => monthKey(a) === activeMonth)

  // On the All tab a month holds both history and queue, so order it as a
  // timeline. The API's scheduled_at ordering alone would scatter anything
  // published straight away, which has no scheduled_at at all.
  const byDate = [...filtered].sort(
    (x, y) => (instantOf(x) || '').localeCompare(instantOf(y) || '')
  )

  // What has already happened, or is happening too soon to move, sits above the
  // part of the list that can still be rearranged. Sorting by date puts them
  // there anyway — the split is only so the queue can be treated as a block.
  const fixed = byDate.filter((a) => !isMovable(a))
  const queue = byDate.filter(isMovable)

  const orderedQueue = override
    ? (override.order
        .map((id) => queue.find((a) => a.id === id))
        .filter(Boolean) as PortalArticle[])
    : queue

  // The dates the client is about to see, before the server has confirmed them.
  const pendingQueue = orderedQueue.map((a) => {
    const slot = override?.when[a.id]
    return slot ? { ...a, scheduled_at: slot.at, scheduled_tz: slot.tz } : a
  })

  const shown = [...fixed, ...pendingQueue]

  // Reordering is a queue operation, so it belongs to the tab that shows the
  // queue on its own. On All the list is interleaved with published history,
  // where moving something has nothing to mean.
  const canReorder = tab === 'scheduled' && view === 'list' && pendingQueue.length > 1

  /**
   * Deals the queue's dates onto the articles in their new order.
   *
   * The dates never move. Thirty articles across thirty days stay on those
   * thirty days; an article dragged to the top takes the earliest date and
   * everything it passed shifts one place later.
   */
  async function commitOrder(next: PortalArticle[]) {
    const slots = orderedQueue
      .map((a) => ({ at: a.scheduled_at as string, tz: a.scheduled_tz ?? null }))
      .sort((x, y) => x.at.localeCompare(y.at))

    const when: Record<string, Slot> = {}
    next.forEach((a, i) => { when[a.id] = slots[i] })

    setOverride({ order: next.map((a) => a.id), when })
    setSaving(true)
    try {
      const res = await fetch(`/api/portal/${token}/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: next.map((a) => a.id) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not save the new order')
      toast.success('Publication dates updated')
      onRefresh()
    } catch (err) {
      // Put the list back where it was rather than leaving dates on screen that
      // nothing agreed to.
      setOverride(null)
      toast.error(err instanceof Error ? err.message : 'Could not save the new order')
    } finally {
      setSaving(false)
    }
  }

  function moveBy(index: number, step: number) {
    const to = index + step
    if (to < 0 || to >= orderedQueue.length) return
    const next = [...orderedQueue]
    ;[next[index], next[to]] = [next[to], next[index]]
    commitOrder(next)
  }

  function dropOn(targetId: string) {
    const ids = orderedQueue.map((a) => a.id)
    const from = dragId ? ids.indexOf(dragId) : -1
    const to = ids.indexOf(targetId)
    setDragId(null)
    if (from < 0 || to < 0 || from === to) return
    const next = [...orderedQueue]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    commitOrder(next)
  }

  async function openArticle(a: PortalArticle) {
    setOpenId(a.id)
    setVersionId(null)
    setEditing(false)
    setEditHtml('')
    // Every open is logged, not just the first — the team's activity trail
    // counts passes. Fire and forget: failing to record it must never stop
    // them reading.
    fetch(`/api/portal/${token}/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ article_id: a.id }),
    })
      .then((r) => (r.ok ? onRefresh() : null))
      .catch(() => {})
  }

  async function submitComment(articleId: string, body: string) {
    try {
      const res = await fetch(`/api/portal/${token}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ article_id: articleId, body }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not send your comment')
      toast.success(
        data.is_billable
          ? 'Comment sent. This is an additional revision.'
          : "Comment sent — we'll take a look."
      )
      onRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send your comment')
      // Rethrown so the thread keeps the message in the box rather than
      // clearing it — a comment that failed to send must not look sent.
      throw err
    }
  }

  /** Approve or pause. Nothing paused publishes, however long it stays that way. */
  async function setPaused(articleId: string, paused: boolean) {
    try {
      const res = await fetch(`/api/portal/${token}/articles/${articleId}/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'That could not be saved')
      toast.success(paused ? 'Paused — this will not publish.' : 'Approved for publishing.')
      onRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That could not be saved')
    }
  }

  /**
   * Opens the editor on the article as it actually stands.
   *
   * Never on the highlighted view. The colours are added at render time and
   * exist only on screen; editing a marked-up copy would type them into the
   * article itself, and they would publish.
   */
  function startEditing(a: PortalArticle) {
    setVersionId(null)
    setEditHtml(a.content)
    setEditing(true)
  }

  async function saveEdit(articleId: string) {
    if (!editHtml.trim() || savingEdit) return
    setSavingEdit(true)
    try {
      const res = await fetch(`/api/portal/${token}/articles/${articleId}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editHtml }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Your changes could not be saved')
      toast.success(`Saved as ${data.draft}.`)
      setEditing(false)
      setEditHtml('')
      onRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Your changes could not be saved')
    } finally {
      setSavingEdit(false)
    }
  }

  /** Leaving the article drops everything that was only true while inside it. */
  function closeArticle() {
    setOpenId(null)
    setVersionId(null)
    setEditing(false)
    setEditHtml('')
  }

  function whenLabel(a: PortalArticle) {
    if (a.status === 'published') {
      return a.published_at ? `Published ${format(new Date(a.published_at), 'MMM d, yyyy')}` : 'Published'
    }
    return a.scheduled_at
      ? `Scheduled ${formatInZone(a.scheduled_at, a.scheduled_tz || 'PST')}`
      : 'Not scheduled'
  }

  // ---- Article detail -------------------------------------------------------
  if (open) {
    const drafts = open.drafts || []
    const view = versionHtml(drafts, versionId, open.content)
    const reading = versionId ? drafts.find((d) => d.id === versionId) : null


    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <button
            onClick={closeArticle}
            className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white mb-6"
          >
            <ArrowLeft className="w-4 h-4" /> Back to all articles
          </button>

          {/* The log and the versions sit beside the article rather than under
              it: both are things you check *while* reading, and a sidebar is
              the only place they can be without pushing the article down. */}
          <div className="grid lg:grid-cols-[17rem_minmax(0,1fr)] gap-5 items-start">
            <div className="space-y-5 lg:sticky lg:top-8">
              <ActivityLog events={open.events || []} mySide="client" />
              <DraftList
                drafts={drafts}
                selectedId={versionId}
                onSelect={setVersionId}
                mySide="client"
              />
            </div>

            <div className="min-w-0">
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-8">
                {/* Approve or pause, above everything. It decides whether any
                    of what follows goes out, so it is not buried under it. */}
                <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                  <ApprovalToggle
                    paused={open.is_paused}
                    canChange={open.commentable}
                    onChange={(paused) => setPaused(open.id, paused)}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 max-w-xs">
                    {open.status === 'published'
                      ? 'This article is already live.'
                      : open.is_paused
                        ? 'Paused — this will not publish until it is approved again.'
                        : 'Approved — this publishes on its schedule unless you pause it.'}
                  </p>
                </div>

                <div className="flex items-start justify-between gap-4 mb-2">
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{open.title}</h1>
                  {open.status === 'published'
                    ? <PublishedTag at={open.published_at} tz={open.scheduled_tz} />
                    : <StateBadge state={open.state} revisedAt={open.revised_at} />}
                </div>
                <p className="text-xs text-gray-400 mb-6 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" /> {whenLabel(open)}
                </p>

                {open.featured_image_url && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={open.featured_image_url}
                    alt=""
                    className="w-full h-auto rounded-xl mb-6"
                  />
                )}

                {editing ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Your changes are saved as a new version. Nothing you replace is lost.
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setEditing(false); setEditHtml('') }}
                          disabled={savingEdit}
                          className="h-9 px-4 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => saveEdit(open.id)}
                          disabled={savingEdit || !editHtml.trim()}
                          className="h-9 px-5 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-40 inline-flex items-center gap-2"
                        >
                          {savingEdit
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Save className="w-4 h-4" />}
                          Save my version
                        </button>
                      </div>
                    </div>
                    <ArticleEditor value={editHtml} onChange={setEditHtml} />
                  </>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                      {/* Whose words are coloured, said in words. The colour
                          alone would be the only thing carrying it, which
                          leaves anyone who cannot separate the two hues with
                          no way to tell the sides apart. */}
                      {view.side ? (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Changes by{' '}
                          <span className={EDIT_CLASS[view.side as AuthorSide]}>
                            {view.author || (view.side === 'client' ? 'you' : 'our team')}
                          </span>{' '}
                          are highlighted.
                        </p>
                      ) : <span />}

                      {open.commentable && (
                        <button
                          onClick={() => startEditing(open)}
                          className="h-9 px-4 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 inline-flex items-center gap-2"
                        >
                          <Pencil className="w-4 h-4" />
                          Edit this article
                        </button>
                      )}
                    </div>

                    {reading && (
                      <p className="text-xs text-gray-400 mb-3">
                        Reading {draftLabel(reading)} — an earlier version. Editing always
                        starts from the current article.
                      </p>
                    )}

                    <article
                      className="article-content text-gray-800 dark:text-gray-200"
                      dangerouslySetInnerHTML={{ __html: view.html }}
                    />
                  </>
                )}
              </div>

              <SeoPanel checks={open.seo} />

              <CollabThread
                messages={open.comments}
                mySide="client"
                canPost={open.commentable}
                placeholder="e.g. Please change the red couches to maroon couches, we don't want our customers to get confused."
                notice={
                  open.comments.some((c) => (c.author_side || 'client') === 'client') ? (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mb-2">
                      You&apos;ve already used the revision included with this article.
                      Additional comments are billed at $10 each.
                    </p>
                  ) : null
                }
                onSend={(body) => submitComment(open.id, body)}
              />
            </div>
          </div>
        </div>
      </div>
    )
  }
  // ---- Article list ---------------------------------------------------------
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <PortalCalendar
        open={showCalendar}
        onClose={() => setShowCalendar(false)}
        articles={articles}
        siteName={siteName}
        onOpenArticle={openArticle}
        onSetPaused={setPaused}
      />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-end justify-between mb-6 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {clientName ? `Hi ${clientName}` : 'Your articles'}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {siteName ? `Articles for ${siteName}. ` : ''}
              Click any article to read it and leave a note.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
          <div className="inline-flex rounded-xl border border-gray-200 dark:border-gray-700 p-1 bg-white dark:bg-gray-800">
            {(['all', 'scheduled', 'published'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3.5 h-9 rounded-lg text-sm font-medium capitalize transition-colors ${
                  tab === t
                    ? 'bg-brand-600 text-white'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="inline-flex rounded-xl border border-gray-200 dark:border-gray-700 p-1 bg-white dark:bg-gray-800">
            <button
              onClick={() => setView('list')}
              aria-label="List view"
              aria-pressed={view === 'list'}
              className={`p-2 rounded-lg ${view === 'list' ? 'bg-brand-600 text-white' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => setView('grid')}
              aria-label="Grid view"
              aria-pressed={view === 'grid'}
              className={`p-2 rounded-lg ${view === 'grid' ? 'bg-brand-600 text-white' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            {/* Not a third view but a way into one: the list and the grid are
                this month, the calendar is the whole schedule. */}
            <button
              onClick={() => setShowCalendar(true)}
              aria-label="Calendar"
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600"
            >
              <CalendarDays className="w-4 h-4" />
            </button>
          </div>
          </div>
        </div>

        {/* Year and month tags — how the client gets back to an earlier month.
            The year row appears only once the portal spans more than one. */}
        {months.length > 0 && (
          <div className="space-y-2 mb-6">
            {showYears && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-gray-400 dark:text-gray-500 w-12">Year</span>
                {years.map((y) => (
                  <MonthTag
                    key={y}
                    label={y}
                    active={activeYear === y}
                    onClick={() => { setYear(y); setMonth(ALL_MONTHS) }}
                  />
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {showYears && (
                <span className="text-xs font-medium text-gray-400 dark:text-gray-500 w-12">Month</span>
              )}
              <MonthTag
                label="All"
                active={activeMonth === ALL_MONTHS}
                onClick={() => setMonth(ALL_MONTHS)}
              />
              {months.map((m) => (
                <MonthTag
                  key={m.key}
                  // The year row above already says which year, so the month
                  // tags do not repeat it.
                  label={monthLabel(m.key, !showYears)}
                  count={m.count}
                  active={activeMonth === m.key}
                  onClick={() => setMonth(m.key)}
                />
              ))}
            </div>
          </div>
        )}

        {!shown.length ? (
          <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 py-20 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {activeMonth !== ALL_MONTHS
                ? `Nothing in ${monthLabel(activeMonth)}.`
                : showYears && activeYear
                  ? `Nothing in ${activeYear}.`
                  : tab === 'published'
                    ? 'Nothing published yet.'
                    : tab === 'all'
                      ? 'No articles yet.'
                      : 'No articles to review just yet.'}
            </p>
          </div>
        ) : view === 'grid' ? (
          <div className="grid sm:grid-cols-2 gap-4">
            {shown.map((a) => (
              <div
                key={a.id}
                className="flex flex-col bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 hover:border-brand-400 transition-colors"
              >
                <button
                  onClick={() => openArticle(a)}
                  className="flex-1 text-left p-5 rounded-2xl"
                >
                  {a.status === 'published'
                    ? <PublishedTag at={a.published_at} tz={a.scheduled_tz} />
                    : <StateBadge state={a.state} revisedAt={a.revised_at} />}
                  <h3 className="font-semibold text-gray-900 dark:text-white mt-3 mb-1.5">{a.title}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-3">{a.snippet}</p>
                  <p className="text-xs text-gray-400 mt-3">{whenLabel(a)}</p>
                </button>

                {/* Pause without opening the article. Whether it publishes is
                    a decision you can make from the list, and the state is
                    visible there too rather than one click away. */}
                {a.commentable && (
                  <div className="flex items-center gap-2.5 px-5 pb-4">
                    <ApprovalToggle
                      compact
                      paused={a.is_paused}
                      canChange
                      onChange={(paused) => setPaused(a.id, paused)}
                    />
                    <span
                      className={`text-xs font-medium ${
                        a.is_paused ? 'text-red-600 dark:text-red-400' : 'text-gray-400'
                      }`}
                    >
                      {a.is_paused ? 'Paused' : 'Approved'}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {canReorder && (
              <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5 px-1">
                <GripVertical className="w-3.5 h-3.5 text-gray-400" />
                Drag an article, or use the arrows, to change the order it publishes in.
                The dates stay where they are — the articles move between them.
                {saving && <Loader2 className="w-3 h-3 animate-spin text-gray-400" />}
              </p>
            )}

            {shown.map((a) => {
              const queueIndex = orderedQueue.findIndex((q) => q.id === a.id)
              const movable = canReorder && queueIndex >= 0
              return (
                <div
                  key={a.id}
                  draggable={movable}
                  onDragStart={() => setDragId(a.id)}
                  onDragOver={(e) => { if (movable && dragId) e.preventDefault() }}
                  onDrop={(e) => { if (movable) { e.preventDefault(); dropOn(a.id) } }}
                  onDragEnd={() => setDragId(null)}
                  className={`flex items-stretch gap-3 transition-opacity ${
                    dragId === a.id ? 'opacity-60' : ''
                  }`}
                >
                  {/* The date stands on its own, beside the article rather
                      than inside it: on a schedule, which day an article lands
                      on is read as often as what it says. */}
                  <DateBlock article={a}>
                    {movable && (
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() => moveBy(queueIndex, -1)}
                          disabled={queueIndex === 0 || saving}
                          aria-label={`Publish ${a.title} sooner`}
                          title="Publish sooner"
                          className="p-0.5 rounded-md text-gray-400 hover:text-brand-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-25 disabled:hover:bg-transparent"
                        >
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        <GripVertical className="w-4 h-4 text-gray-300 dark:text-gray-600 cursor-grab active:cursor-grabbing" />
                        <button
                          onClick={() => moveBy(queueIndex, 1)}
                          disabled={queueIndex === orderedQueue.length - 1 || saving}
                          aria-label={`Publish ${a.title} later`}
                          title="Publish later"
                          className="p-0.5 rounded-md text-gray-400 hover:text-brand-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-25 disabled:hover:bg-transparent"
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </DateBlock>

                  <div
                    className={`flex-1 min-w-0 flex items-stretch bg-white dark:bg-gray-800 rounded-2xl border transition-colors ${
                      dragId === a.id
                        ? 'border-brand-400'
                        : 'border-gray-100 dark:border-gray-700 hover:border-brand-400'
                    }`}
                  >
                    <button
                      onClick={() => openArticle(a)}
                      className="flex-1 min-w-0 text-left px-5 py-4 rounded-2xl hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <h3 className="font-medium text-gray-900 dark:text-white truncate">{a.title}</h3>
                          <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 mt-0.5">{a.snippet}</p>
                        </div>
                        <div className="flex-shrink-0">
                          {a.status === 'published'
                            ? <PublishedTag at={a.published_at} tz={a.scheduled_tz} />
                            : <StateBadge state={a.state} revisedAt={a.revised_at} />}
                        </div>
                      </div>
                    </button>

                    {/* Outside the row's own button — a control nested in a
                        button would open the article on every click. */}
                    {a.commentable && (
                      <div className="flex items-center pr-4 pl-1">
                        <ApprovalToggle
                          compact
                          paused={a.is_paused}
                          canChange
                          onChange={(paused) => setPaused(a.id, paused)}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

interface MonthTagProps {
  label: string
  count?: number
  active: boolean
  onClick: () => void
}

function MonthTag({ label, count, active, onClick }: MonthTagProps) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-medium border transition-colors ${
        active
          ? 'bg-brand-600 border-brand-600 text-white'
          : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400'
      }`}
    >
      {label}
      {count !== undefined && (
        <span className={active ? 'opacity-75' : 'text-gray-400'}>{count}</span>
      )}
    </button>
  )
}
