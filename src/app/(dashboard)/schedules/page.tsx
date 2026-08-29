'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import {
  Play, Pause, Pencil, Calendar, Archive, Loader2, Globe,
  ExternalLink, FileText, AlertTriangle, RefreshCw,
} from 'lucide-react'
import Header from '@/components/layout/Header'
import ScheduleCalendarModal from '@/components/ui/ScheduleCalendarModal'
import ScheduleCalendarOverview from '@/components/schedules/ScheduleCalendarOverview'
import type { Article, Site } from '@/types'
import { formatInZone } from '@/lib/timezone'
import { ALL_SITES, siteParam } from '@/lib/site-filter'
import toast from 'react-hot-toast'

type Tab = 'published' | 'scheduled'

export default function SchedulesPage() {
  const [sites, setSites] = useState<Site[]>([])
  // Defaults to every site, so the page opens on the whole queue rather than
  // on whichever site happens to sort first.
  const [siteId, setSiteId] = useState<string>(ALL_SITES)
  const [tab, setTab] = useState<Tab>('scheduled')
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [calendarFor, setCalendarFor] = useState<Article | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showOverview, setShowOverview] = useState(false)
  // Both totals for the current site, so each tab can carry its own — the tab
  // you are not looking at has a number worth seeing too.
  const [counts, setCounts] = useState<{ published: number; scheduled: number } | null>(null)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    fetch('/api/sites')
      .then((r) => r.json())
      .then((d) => {
        setSites(d.sites || [])
      })
      .catch(() => toast.error('Could not load sites'))
  }, [])

  const fetchArticles = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/articles?status=${tab}&events=true${siteParam(siteId)}`)
      const data = await res.json()
      // Don't let a failed request render as an empty list — that reads as
      // "your articles are gone" when they are simply unreadable right now.
      if (!res.ok) throw new Error(data.error || 'Could not load articles')
      setArticles(data.articles || [])
      setLoadError(null)
    } catch (err) {
      setArticles([])
      const msg = err instanceof Error ? err.message : 'Could not load articles'
      setLoadError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [siteId, tab])

  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetch(`/api/articles?counts=true${siteParam(siteId)}`)
      const data = await res.json()
      if (res.ok) setCounts(data.counts || null)
    } catch {
      // A missing total is not worth a message; the list itself still loads.
    }
  }, [siteId])

  useEffect(() => { fetchArticles() }, [fetchArticles])
  useEffect(() => { fetchCounts() }, [fetchCounts])

  // Reconciling has to re-read the list, but it must not re-run every time the
  // list changes — a ref keeps the sweep keyed to the site alone.
  const fetchRef = useRef(fetchArticles)
  useEffect(() => { fetchRef.current = fetchArticles })

  // WordPress, not this app, publishes a scheduled post, and it never calls
  // back to say it did. Without this the article stays under Scheduled forever
  // even though it is already live. So ask WordPress what actually went out,
  // and let anything it has published move itself over to Published.
  //
  // Runs alongside the list rather than gating it: a slow or unreachable site
  // should delay the correction, never the page.
  useEffect(() => {
    let cancelled = false
    setSyncing(true)

    fetch('/api/articles/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_id: siteId === ALL_SITES ? null : siteId }),
    })
      .then(async (res) => ({ ok: res.ok, data: await res.json() }))
      .then(({ ok, data }) => {
        if (cancelled || !ok) return

        if (data.moved > 0) {
          toast.success(
            data.moved === 1
              ? 'An article finished publishing — moved to Published'
              : `${data.moved} articles finished publishing — moved to Published`
          )
          fetchRef.current()
        }

        // Say so rather than leaving a stale queue looking authoritative.
        if (data.unreachable?.length) {
          toast.error(
            `Could not reach ${data.unreachable.join(', ')} — this queue may be out of date.`,
            { duration: 8000 }
          )
        }
      })
      // A failed sweep is not worth interrupting the page for; the list below
      // is still the last thing we knew to be true.
      .catch(() => {})
      .finally(() => { if (!cancelled) setSyncing(false) })

    return () => { cancelled = true }
  }, [siteId])

  // Every row control goes through the same endpoint, which also mirrors the
  // change onto the WordPress post holding the scheduled slot.
  async function patchSchedule(id: string, body: Record<string, unknown>, successMsg: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/articles/${id}/schedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Update failed')
      toast.success(successMsg)
      if (data.wpWarning) {
        toast.error(`WordPress: ${data.wpWarning}`, { duration: 8000 })
      }
      await fetchArticles()
      fetchCounts()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusyId(null)
    }
  }

  const currentSite = sites.find((s) => s.id === siteId)
  const viewingAll = siteId === ALL_SITES
  // What the empty states call the current scope.
  const scopeLabel = viewingAll ? 'any site' : currentSite?.name ?? 'this site'

  return (
    <>
      <Header title="Schedules" subtitle="Pick a site, then manage what it has published and what is queued" />

      <div className="p-6 max-w-5xl">
        {/* Site filter */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Site</label>
          <div className="flex items-center gap-2">
            <div className="relative max-w-sm flex-1">
              <Globe className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                className="w-full h-11 pl-9 pr-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white appearance-none"
              >
                {!sites.length && <option value="">No sites connected</option>}
                <option value={ALL_SITES}>All sites</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <button
              onClick={() => setShowOverview(true)}
              disabled={!sites.length}
              title="See the publishing calendar"
              aria-label="See the publishing calendar"
              className="h-11 w-11 flex items-center justify-center rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 hover:text-brand-600 hover:border-brand-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
            >
              <Calendar className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Published / Scheduled filter */}
        <div className="flex items-center gap-3 mb-5">
          <div className="inline-flex rounded-xl border border-gray-200 dark:border-gray-700 p-1 bg-white dark:bg-gray-800">
            {(['published', 'scheduled'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 h-9 rounded-lg text-sm font-medium capitalize transition-colors ${
                  tab === t
                    ? 'bg-brand-600 text-white'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                {t}
                {counts && (
                  <span className={`ml-1.5 tabular-nums font-normal ${
                    tab === t ? 'text-white/70' : 'text-gray-400 dark:text-gray-500'
                  }`}>
                    ({counts[t].toLocaleString()})
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* The queue is only as current as WordPress, so show when we are
              asking it — a row leaving Scheduled a beat later is otherwise
              unexplained. */}
          {syncing && (
            <span className="flex items-center gap-1.5 text-xs text-gray-400">
              <RefreshCw className="w-3 h-3 animate-spin" />
              Checking WordPress
            </span>
          )}
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : loadError ? (
          <div className="rounded-2xl border border-red-200 dark:border-red-900/40 bg-red-50/50 dark:bg-red-900/10 py-12 px-6 text-center">
            <AlertTriangle className="w-7 h-7 text-red-500 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-900 dark:text-white">Could not load these articles</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{loadError}</p>
            <p className="text-xs text-gray-400 mt-2">
              Nothing has been deleted — this is a read failure.
            </p>
            <button
              onClick={fetchArticles}
              className="mt-4 bg-brand-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-brand-700"
            >
              Try again
            </button>
          </div>
        ) : !sites.length ? (
          <EmptyState text="Connect a site to get started." />
        ) : !articles.length ? (
          <EmptyState
            text={
              tab === 'published'
                ? `Nothing published on ${scopeLabel} yet.`
                : `Nothing queued for ${scopeLabel}.`
            }
          />
        ) : (
          <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700 overflow-hidden">
            {articles.map((a, i) =>
              tab === 'published' ? (
                <PublishedRow key={a.id} article={a} index={i + 1} showSite={viewingAll} />
              ) : (
                <ScheduledRow
                  key={a.id}
                  article={a}
                  index={i + 1}
                  showSite={viewingAll}
                  busy={busyId === a.id}
                  onPlay={() => patchSchedule(a.id, { is_paused: false }, 'Scheduled')}
                  onPause={() => patchSchedule(a.id, { is_paused: true }, 'Paused')}
                  onCalendar={() => setCalendarFor(a)}
                  onArchive={() => patchSchedule(a.id, { archived: true }, 'Moved to Archive')}
                />
              )
            )}
          </div>
        )}
      </div>

      <ScheduleCalendarOverview
        open={showOverview}
        onClose={() => setShowOverview(false)}
        siteId={siteId}
        siteName={viewingAll ? 'All sites' : currentSite?.name}
        // On All sites, this is what gives each one its colour.
        sites={sites}
        onChanged={fetchArticles}
      />

      {calendarFor && (
        <ScheduleCalendarModal
          key={calendarFor.id}
          open
          onClose={() => setCalendarFor(null)}
          articleTitle={calendarFor.title}
          siteId={calendarFor.site_id}
          onCalendarChanged={fetchArticles}
          currentIso={calendarFor.scheduled_at}
          currentTz={calendarFor.scheduled_tz}
          saving={busyId === calendarFor.id}
          onSave={async (iso, tzId) => {
            await patchSchedule(
              calendarFor.id,
              { scheduled_at: iso, scheduled_tz: tzId },
              'Schedule updated'
            )
            setCalendarFor(null)
          }}
        />
      )}
    </>
  )
}

/**
 * Internal activity trail — team edits and client views, in order.
 *
 * Numbered rather than bulleted because the question it answers is "how many
 * rounds did this take", which a count makes obvious at a glance.
 */
function ActivityTrail({ article }: { article: Article }) {
  const events = article.events || []
  if (!events.length) return null

  const tz = article.scheduled_tz || 'PST'

  return (
    <ol className="mt-2 ml-1 space-y-0.5">
      {events.map((e, i) => (
        <li key={e.id} className="text-xs text-gray-400 flex gap-1.5">
          <span className="tabular-nums text-gray-300 dark:text-gray-600">{i + 1}.</span>
          <span>
            <span className={e.kind === 'edited'
              ? 'text-gray-600 dark:text-gray-300'
              : 'text-brand-600 dark:text-brand-400'}>
              {e.kind === 'edited' ? 'Edited by' : 'Viewed by'} {e.actor || 'Unknown'}
            </span>
            {' '}
            {formatInZone(e.created_at, tz)}
          </span>
        </li>
      ))}
    </ol>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 py-16 text-center">
      <FileText className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
      <p className="text-sm text-gray-500 dark:text-gray-400">{text}</p>
    </div>
  )
}

/** The site an article belongs to — only worth a line when the list spans sites. */
function SiteLabel({ article }: { article: Article }) {
  if (!article.sites?.name) return null
  return (
    <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1 mt-0.5">
      <Globe className="w-3 h-3 flex-shrink-0" />
      <span className="truncate">{article.sites.name}</span>
    </p>
  )
}

/**
 * The row's place in the list. Counting rows by eye is the thing this page is
 * used for — "how many went out this month" — and a numeral answers it without
 * anyone having to count at all.
 */
function RowNumber({ n }: { n: number }) {
  return (
    <span className="w-7 shrink-0 pt-0.5 text-sm tabular-nums text-gray-300 dark:text-gray-600 text-right">
      {n}.
    </span>
  )
}

function PublishedRow({ article, index, showSite }: {
  article: Article
  index: number
  showSite?: boolean
}) {
  return (
    <div className="flex items-start gap-3 px-5 py-3.5">
      <RowNumber n={index} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{article.title}</p>
        {showSite && <SiteLabel article={article} />}
        <p className="text-xs text-gray-400 mt-0.5">
          {article.published_at
            ? formatInZone(article.published_at, article.scheduled_tz || 'PST')
            : '—'}
        </p>
        <ActivityTrail article={article} />
      </div>
      {article.wp_post_url && (
        <a
          href={article.wp_post_url}
          target="_blank"
          rel="noopener noreferrer"
          className="p-2 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-gray-100 dark:hover:bg-gray-700"
          title="View on WordPress"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </div>
  )
}

interface ScheduledRowProps {
  article: Article
  /** Its place in the list, counted from the top. */
  index: number
  /** Label each row with its site — on when the list spans every site. */
  showSite?: boolean
  busy: boolean
  onPlay: () => void
  onPause: () => void
  onCalendar: () => void
  onArchive: () => void
}

function ScheduledRow({
  article, index, showSite, busy, onPlay, onPause, onCalendar, onArchive,
}: ScheduledRowProps) {
  const paused = !!article.is_paused
  const iconBtn =
    'p-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
  // The active state is deliberately not just a different hue. Green against
  // grey is exactly the pair red-green colour blindness flattens, so the live
  // control also gets a solid fill and a much brighter value — it reads as
  // "lit up" on luminance alone, without relying on seeing the colour.
  const idle = 'text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
  const active = 'text-[#39ff14] bg-[#39ff14]/15 ring-1 ring-[#39ff14]/60 hover:bg-[#39ff14]/25'
  const neutral = 'text-gray-400 hover:text-brand-600 hover:bg-gray-100 dark:hover:bg-gray-700'

  return (
    <div className="flex items-start gap-3 px-5 py-3.5">
      <RowNumber n={index} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{article.title}</p>
        {showSite && <SiteLabel article={article} />}
        <p className="text-xs text-gray-400 mt-0.5">
          {article.scheduled_at
            ? formatInZone(article.scheduled_at, article.scheduled_tz || 'PST')
            : 'No time set'}
          {paused && <span className="ml-2 text-amber-500 font-medium">Paused</span>}
        </p>
        <ActivityTrail article={article} />
      </div>

      <div className="flex items-center gap-0.5 flex-shrink-0">
        {busy && <Loader2 className="w-4 h-4 animate-spin text-gray-400 mr-1" />}

        {/* Play is green while the article is actively scheduled */}
        <button
          onClick={onPlay}
          disabled={busy || !paused}
          className={`${iconBtn} ${paused ? idle : active}`}
          title={paused ? 'Resume — publish at the scheduled time' : 'Scheduled'}
        >
          <Play
            className="w-4 h-4"
            fill="currentColor"
            style={paused ? undefined : { filter: 'drop-shadow(0 0 4px rgba(57,255,20,0.9))' }}
          />
        </button>

        {/* Pause is green while the article is held back */}
        <button
          onClick={onPause}
          disabled={busy || paused}
          className={`${iconBtn} ${paused ? active : idle}`}
          title={paused ? 'Paused' : 'Pause — hold this back from publishing'}
        >
          <Pause
            className="w-4 h-4"
            fill="currentColor"
            style={paused ? { filter: 'drop-shadow(0 0 4px rgba(57,255,20,0.9))' } : undefined}
          />
        </button>

        <Link
          href={`/articles/${article.id}`}
          className={`${iconBtn} ${neutral}`}
          title="Edit article"
        >
          <Pencil className="w-4 h-4" />
        </Link>

        <button onClick={onCalendar} disabled={busy} className={`${iconBtn} ${neutral}`} title="Change publish time">
          <Calendar className="w-4 h-4" />
        </button>

        <button onClick={onArchive} disabled={busy} className={`${iconBtn} ${neutral}`} title="Move to Archive">
          <Archive className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
