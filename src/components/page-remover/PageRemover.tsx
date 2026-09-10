'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ExternalLink,
  Loader2,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'

import Header from '@/components/layout/Header'
import type { Site } from '@/types'

interface WPItem {
  id: number
  slug: string
  title: string
  link: string
  status: string
  modifiedGmt?: string
  dateGmt?: string
}

type View = 'active' | 'trash'
type Kind = 'post' | 'page'

const LAST_SITE_KEY = 'zaoflo_page_remover_last_site_id'

function formatDate(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Convert a `YYYY-MM-DD` input value into an ISO instant. `end=true` snaps to
 *  the end of the day so a filter typed as "before 2025-01-31" also includes
 *  items published that same day. */
function toIso(date: string, end = false): string | undefined {
  if (!date) return undefined
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return undefined
  const base = end
    ? new Date(Date.UTC(y, m - 1, d, 23, 59, 59))
    : new Date(Date.UTC(y, m - 1, d, 0, 0, 0))
  return base.toISOString()
}

export default function PageRemover() {
  const [sites, setSites] = useState<Site[]>([])
  const [sitesLoading, setSitesLoading] = useState(true)
  const [siteId, setSiteId] = useState('')

  const [kind, setKind] = useState<Kind>('page')
  const [view, setView] = useState<View>('active')

  const [items, setItems] = useState<WPItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Search is applied client-side so typing feels instant, but a longer query
  // also gets forwarded to WP on the next reload for large sites where the
  // client only has the first few thousand items in memory.
  const [query, setQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [busyId, setBusyId] = useState<number | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  useEffect(() => {
    setSitesLoading(true)
    fetch('/api/sites')
      .then((r) => r.json())
      .then((d) => {
        const wpSites: Site[] = (d.sites || []).filter((s: Site) => s.site_type === 'wordpress')
        setSites(wpSites)
        if (typeof window !== 'undefined') {
          const last = window.localStorage.getItem(LAST_SITE_KEY)
          if (last && wpSites.some((s) => s.id === last)) setSiteId(last)
          else if (wpSites.length > 0) setSiteId(wpSites[0].id)
        } else if (wpSites.length > 0) {
          setSiteId(wpSites[0].id)
        }
      })
      .catch(() => toast.error('Failed to load sites'))
      .finally(() => setSitesLoading(false))
  }, [])

  useEffect(() => {
    if (!siteId || typeof window === 'undefined') return
    window.localStorage.setItem(LAST_SITE_KEY, siteId)
  }, [siteId])

  // Load the item list whenever the site, kind, view, or date range changes.
  // Search is applied client-side (fast) but also forwarded to WP so a search
  // string can narrow the fetched set on very large sites.
  useEffect(() => {
    if (!siteId) {
      setItems([])
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ site_id: siteId, kind, view })
    const after = toIso(dateFrom, false)
    const before = toIso(dateTo, true)
    if (after) params.set('after', after)
    if (before) params.set('before', before)
    fetch(`/api/page-remover/list?${params}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (cancelled) return
        if (!ok) throw new Error(d?.error || 'Failed to load')
        setItems((d.pages || []) as WPItem[])
      })
      .catch((err) => {
        if (cancelled) return
        setItems([])
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [siteId, kind, view, dateFrom, dateTo])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((p) => {
      const title = (p.title || '').toLowerCase()
      const slug = (p.slug || '').toLowerCase()
      const link = (p.link || '').toLowerCase()
      return title.includes(q) || slug.includes(q) || link.includes(q)
    })
  }, [items, query])

  // Reset selection whenever the underlying data pool changes so a stale id
  // from a previous site/view can't linger and trigger a hidden bulk action.
  useEffect(() => {
    setSelected(new Set())
  }, [siteId, kind, view])

  const filteredIds = useMemo(() => filtered.map((p) => p.id), [filtered])
  const selectedInView = useMemo(
    () => filteredIds.filter((id) => selected.has(id)),
    [filteredIds, selected],
  )
  const allFilteredSelected = filtered.length > 0 && selectedInView.length === filtered.length
  const someFilteredSelected = selectedInView.length > 0 && !allFilteredSelected

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) {
        for (const id of filteredIds) next.delete(id)
      } else {
        for (const id of filteredIds) next.add(id)
      }
      return next
    })
  }

  async function actOnId(pageId: number, action: 'trash' | 'restore' | 'delete') {
    const res = await fetch('/api/page-remover/item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_id: siteId, page_id: pageId, kind, action }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || 'Action failed')
  }

  async function bulkAct(action: 'trash' | 'restore' | 'delete') {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    const label = action === 'trash' ? 'move to trash' : action === 'restore' ? 'restore' : 'permanently delete'
    if (action === 'delete') {
      if (!confirm(`Permanently delete ${ids.length} item${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return
    } else if (!confirm(`${label.charAt(0).toUpperCase()}${label.slice(1)} ${ids.length} item${ids.length === 1 ? '' : 's'}?`)) {
      return
    }

    setBulkBusy(true)
    const results = await Promise.allSettled(ids.map((id) => actOnId(id, action)))
    const succeeded: number[] = []
    const failures: string[] = []
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') succeeded.push(ids[i])
      else failures.push(r.reason instanceof Error ? r.reason.message : String(r.reason))
    })

    if (succeeded.length > 0) {
      const succeededSet = new Set(succeeded)
      setItems((prev) => prev.filter((p) => !succeededSet.has(p.id)))
      setSelected((prev) => {
        const next = new Set(prev)
        for (const id of succeeded) next.delete(id)
        return next
      })
    }
    if (failures.length === 0) {
      toast.success(
        action === 'trash'
          ? `Moved ${succeeded.length} to trash`
          : action === 'restore'
            ? `Restored ${succeeded.length} as drafts`
            : `Deleted ${succeeded.length} permanently`,
      )
    } else {
      toast.error(`${failures.length} of ${ids.length} failed: ${failures[0]}`)
    }
    setBulkBusy(false)
  }

  async function act(item: WPItem, action: 'trash' | 'restore' | 'delete') {
    if (action === 'delete') {
      if (!confirm(`Permanently delete "${item.title || item.slug}"? This cannot be undone.`)) return
    }
    setBusyId(item.id)
    try {
      const res = await fetch('/api/page-remover/item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: siteId, page_id: item.id, kind, action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Action failed')
      // Optimistic removal from the list — a trashed item leaves the Active
      // view, a restored item leaves the Trash view, and a force delete
      // removes it from wherever it was.
      setItems((prev) => prev.filter((p) => p.id !== item.id))
      toast.success(
        action === 'trash'
          ? 'Moved to trash'
          : action === 'restore'
            ? 'Restored as draft'
            : 'Deleted permanently',
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusyId(null)
    }
  }

  const dateActive = Boolean(dateFrom || dateTo)
  const searchActive = query.trim().length > 0

  return (
    <div>
      <Header
        title="Page Remover"
        subtitle="Trash WordPress pages and posts, restore them, or delete them permanently."
      />

      <div className="max-w-6xl space-y-4">
        <section className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 border border-gray-200 dark:border-gray-700 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                WordPress site
              </label>
              <select
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                disabled={sitesLoading}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
              >
                <option value="">
                  {sitesLoading
                    ? 'Loading sites…'
                    : sites.length === 0
                      ? 'No WordPress sites — add one first'
                      : 'Pick a site'}
                </option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Source type</label>
              <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 text-sm">
                {(['page', 'post'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={`flex-1 py-2 transition-colors ${
                      kind === k
                        ? 'bg-brand-600 text-white'
                        : 'bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600'
                    }`}
                  >
                    {k === 'page' ? 'Pages' : 'Posts'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 text-sm">
            {(['active', 'trash'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`flex-1 py-2 transition-colors ${
                  view === v
                    ? 'bg-brand-600 text-white'
                    : 'bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600'
                }`}
              >
                {v === 'active' ? 'Active' : 'Trash'}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-1">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Title, slug or URL…"
                  className="w-full pl-9 pr-8 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                {query && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">From date</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">To date</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          {(dateActive || searchActive) && (
            <div className="flex items-center gap-3 text-xs">
              <span className="text-gray-500 dark:text-gray-400">
                {searchActive && dateActive
                  ? 'Filtering by search and date'
                  : searchActive
                    ? 'Filtering by search'
                    : 'Filtering by date'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  setDateFrom('')
                  setDateTo('')
                }}
                className="text-brand-600 dark:text-brand-400 hover:underline"
              >
                Clear filters
              </button>
            </div>
          )}
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/40">
            <div className="flex items-center gap-3">
              <input
                ref={(el) => {
                  if (el) el.indeterminate = someFilteredSelected
                }}
                type="checkbox"
                aria-label="Select all items on this view"
                checked={allFilteredSelected}
                onChange={toggleAllFiltered}
                disabled={loading || filtered.length === 0}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500 disabled:opacity-40"
              />
              <div className="text-sm text-gray-700 dark:text-gray-200">
                {loading ? (
                  <span className="inline-flex items-center gap-2 text-gray-500 dark:text-gray-400">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                  </span>
                ) : selected.size > 0 ? (
                  <>
                    <strong>{selected.size}</strong> selected
                  </>
                ) : (
                  <>
                    <strong>{filtered.length}</strong> {view === 'trash' ? 'in trash' : 'active'}
                    {filtered.length !== items.length && (
                      <span className="text-gray-500 dark:text-gray-400"> of {items.length}</span>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {selected.size > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    disabled={bulkBusy}
                    className="text-xs text-gray-600 dark:text-gray-300 hover:underline disabled:opacity-50"
                  >
                    Clear
                  </button>
                  {view === 'active' ? (
                    <button
                      type="button"
                      onClick={() => bulkAct('trash')}
                      disabled={bulkBusy}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {bulkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      Trash selected
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => bulkAct('restore')}
                        disabled={bulkBusy}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {bulkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                        Restore selected
                      </button>
                      <button
                        type="button"
                        onClick={() => bulkAct('delete')}
                        disabled={bulkBusy}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {bulkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        Delete selected
                      </button>
                    </>
                  )}
                </>
              )}
              {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
            </div>
          </div>

          {!loading && filtered.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
              {!siteId
                ? 'Pick a site to load items.'
                : items.length === 0
                  ? view === 'trash'
                    ? 'Trash is empty.'
                    : `No ${kind === 'page' ? 'pages' : 'posts'} found.`
                  : `No matches for the current filters.`}
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.map((item) => {
                const busy = busyId === item.id
                const checked = selected.has(item.id)
                return (
                  <li key={item.id} className="px-4 py-3 flex flex-wrap items-center gap-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${item.title || item.slug}`}
                      checked={checked}
                      onChange={() => toggleOne(item.id)}
                      disabled={bulkBusy}
                      className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500 disabled:opacity-40"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {item.title || item.slug}
                      </div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                        <span className="truncate">{item.link || `/${item.slug}`}</span>
                        <span className="shrink-0">
                          Published {formatDate(item.dateGmt)}
                        </span>
                        <span className="shrink-0">
                          Modified {formatDate(item.modifiedGmt)}
                        </span>
                        <span className="shrink-0 uppercase tracking-wide">{item.status}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {item.link && item.status !== 'trash' && (
                        <a
                          href={item.link}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400 hover:underline"
                        >
                          Open <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      {view === 'active' ? (
                        <button
                          type="button"
                          onClick={() => act(item, 'trash')}
                          disabled={busy}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          Trash
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => act(item, 'restore')}
                            disabled={busy}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                            Restore
                          </button>
                          <button
                            type="button"
                            onClick={() => act(item, 'delete')}
                            disabled={busy}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            Delete permanently
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
