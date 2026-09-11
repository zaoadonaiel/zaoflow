'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  Copy,
  Grid3x3,
  List,
  Loader2,
  Search,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'

import Header from '@/components/layout/Header'
import type { Site } from '@/types'

interface WPPage {
  id: number
  slug: string
  title: string
  link: string
  status: string
}

type ViewMode = 'grid' | 'list'

const LAST_SITE_KEY = 'zaoflo_city_buttons_last_site_id'
const LAST_VIEW_KEY = 'zaoflo_city_buttons_view_mode'
const LAST_EXCLUDED_KEY = 'zaoflo_city_buttons_excluded_words'

/**
 * Strip each excluded token from a title, matching whole words case-insensitively.
 * Runs a second collapse pass so "Web Design Santa Monica CA" with excludes
 * "web,design,ca" ends up as "Santa Monica" and not "  Santa Monica  ".
 */
function cleanLabel(title: string, excluded: string[]): string {
  if (!excluded.length) return title.trim()
  let out = title
  for (const raw of excluded) {
    const word = raw.trim()
    if (!word) continue
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '')
  }
  return out.replace(/\s+/g, ' ').trim()
}

function splitExcluded(input: string): string[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export default function CityButtons() {
  const [sites, setSites] = useState<Site[]>([])
  const [sitesLoading, setSitesLoading] = useState(true)
  const [siteId, setSiteId] = useState('')

  const [pages, setPages] = useState<WPPage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [query, setQuery] = useState('')
  // Preserve the order pages were clicked in — the shortcode's ids and labels
  // are position-matched, so a Set would randomise the button row.
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [excludedInput, setExcludedInput] = useState('')

  const [copied, setCopied] = useState(false)

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
    if (typeof window === 'undefined') return
    const savedView = window.localStorage.getItem(LAST_VIEW_KEY)
    if (savedView === 'grid' || savedView === 'list') setViewMode(savedView)
    const savedExcluded = window.localStorage.getItem(LAST_EXCLUDED_KEY)
    if (savedExcluded) setExcludedInput(savedExcluded)
  }, [])

  useEffect(() => {
    if (!siteId || typeof window === 'undefined') return
    window.localStorage.setItem(LAST_SITE_KEY, siteId)
  }, [siteId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(LAST_VIEW_KEY, viewMode)
  }, [viewMode])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(LAST_EXCLUDED_KEY, excludedInput)
  }, [excludedInput])

  useEffect(() => {
    if (!siteId) {
      setPages([])
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setSelectedIds([])
    fetch(`/api/city-buttons/pages?site_id=${siteId}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (cancelled) return
        if (!ok) throw new Error(d?.error || 'Failed to load pages')
        setPages((d.pages || []) as WPPage[])
      })
      .catch((err) => {
        if (cancelled) return
        setPages([])
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [siteId])

  const filteredPages = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return pages
    return pages.filter((p) =>
      (p.title || '').toLowerCase().includes(q) ||
      (p.slug || '').toLowerCase().includes(q),
    )
  }, [pages, query])

  const pageById = useMemo(() => {
    const m = new Map<number, WPPage>()
    for (const p of pages) m.set(p.id, p)
    return m
  }, [pages])

  const excludedWords = useMemo(() => splitExcluded(excludedInput), [excludedInput])

  const selectedPages = useMemo(
    () => selectedIds.map((id) => pageById.get(id)).filter(Boolean) as WPPage[],
    [selectedIds, pageById],
  )

  // Any selection whose label collapsed to nothing after stripping would emit
  // an empty pipe segment — surface those so the user can adjust the words
  // rather than shipping a blank button.
  const labelRows = useMemo(
    () => selectedPages.map((p) => ({
      id: p.id,
      original: p.title,
      cleaned: cleanLabel(p.title, excludedWords),
    })),
    [selectedPages, excludedWords],
  )

  const hasEmptyLabels = labelRows.some((r) => !r.cleaned)

  const shortcode = useMemo(() => {
    if (labelRows.length === 0) return ''
    const ids = labelRows.map((r) => r.id).join(',')
    const labels = labelRows.map((r) => r.cleaned || r.original).join('|')
    return `[zao_page_buttons ids="${ids}" labels="${labels}"]`
  }, [labelRows])

  function toggleOne(id: number) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function clearSelection() {
    setSelectedIds([])
  }

  function selectAllFiltered() {
    setSelectedIds((prev) => {
      const seen = new Set(prev)
      const next = [...prev]
      for (const p of filteredPages) {
        if (!seen.has(p.id)) {
          next.push(p.id)
          seen.add(p.id)
        }
      }
      return next
    })
  }

  async function copyShortcode() {
    if (!shortcode) return
    try {
      await navigator.clipboard.writeText(shortcode)
      setCopied(true)
      toast.success('Copied!')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Copy failed — select the text and copy manually.')
    }
  }

  return (
    <div>
      <Header
        title="City Buttons"
        subtitle="Generate a WordPress button-row shortcode from a group of city pages."
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
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                View
              </label>
              <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 text-sm">
                {([
                  { key: 'grid' as const, label: 'Grid', Icon: Grid3x3 },
                  { key: 'list' as const, label: 'List', Icon: List },
                ]).map(({ key, label, Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setViewMode(key)}
                    className={`flex-1 py-2 flex items-center justify-center gap-2 transition-colors ${
                      viewMode === key
                        ? 'bg-brand-600 text-white'
                        : 'bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Search pages
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Title or slug…"
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
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/40">
            <div className="text-sm text-gray-700 dark:text-gray-200">
              {loading ? (
                <span className="inline-flex items-center gap-2 text-gray-500 dark:text-gray-400">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading pages…
                </span>
              ) : selectedIds.length > 0 ? (
                <>
                  <strong>{selectedIds.length}</strong> selected
                  <span className="text-gray-500 dark:text-gray-400"> of {pages.length}</span>
                </>
              ) : (
                <>
                  <strong>{filteredPages.length}</strong> page{filteredPages.length === 1 ? '' : 's'}
                  {filteredPages.length !== pages.length && (
                    <span className="text-gray-500 dark:text-gray-400"> of {pages.length}</span>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-3">
              {filteredPages.length > 0 && (
                <button
                  type="button"
                  onClick={selectAllFiltered}
                  className="text-xs text-brand-600 dark:text-brand-400 hover:underline"
                >
                  Select all shown
                </button>
              )}
              {selectedIds.length > 0 && (
                <button
                  type="button"
                  onClick={clearSelection}
                  className="text-xs text-gray-600 dark:text-gray-300 hover:underline"
                >
                  Clear
                </button>
              )}
              {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
            </div>
          </div>

          {!loading && filteredPages.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
              {!siteId
                ? 'Pick a site to load pages.'
                : pages.length === 0
                  ? 'No published pages on this site.'
                  : 'No pages match the current search.'}
            </div>
          ) : viewMode === 'grid' ? (
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {filteredPages.map((p) => {
                const checked = selectedIds.includes(p.id)
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleOne(p.id)}
                    className={`relative text-left rounded-xl border-2 p-3 h-28 flex flex-col justify-between transition-colors ${
                      checked
                        ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30'
                        : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 hover:border-brand-300 dark:hover:border-brand-700'
                    }`}
                  >
                    <div
                      className={`absolute top-2 right-2 w-5 h-5 rounded flex items-center justify-center transition-colors ${
                        checked
                          ? 'bg-brand-600 text-white'
                          : 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600'
                      }`}
                      aria-hidden="true"
                    >
                      {checked && <Check className="w-3.5 h-3.5" />}
                    </div>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 pr-6 line-clamp-3">
                      {p.title || p.slug}
                    </div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                      {p.slug}
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {filteredPages.map((p) => {
                const checked = selectedIds.includes(p.id)
                return (
                  <li key={p.id}>
                    <label className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900/40">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOne(p.id)}
                        className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {p.title || p.slug}
                        </div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                          {p.link || `/${p.slug}`}
                        </div>
                      </div>
                      <span className="text-[11px] text-gray-400 shrink-0">#{p.id}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {selectedIds.length > 0 && (
          <>
            <section className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 border border-gray-200 dark:border-gray-700 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Words to strip from labels
                </label>
                <input
                  type="text"
                  value={excludedInput}
                  onChange={(e) => setExcludedInput(e.target.value)}
                  placeholder="design, CA, near me"
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  Comma-separated. Whole-word, case-insensitive.
                </p>
              </div>

              <div className="rounded-lg border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
                {labelRows.map((row) => (
                  <div key={row.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-gray-400 truncate">{row.original}</div>
                      <div className={`font-medium truncate ${row.cleaned ? 'text-gray-900 dark:text-gray-100' : 'text-red-600 dark:text-red-400'}`}>
                        {row.cleaned || 'Empty after stripping — adjust words above'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleOne(row.id)}
                      className="text-[11px] text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                      title="Remove from selection"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              {hasEmptyLabels && (
                <p className="text-xs text-red-600 dark:text-red-400">
                  One or more labels collapsed to empty — the shortcode will fall back to the original title for those.
                </p>
              )}
            </section>

            <section className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 border border-gray-200 dark:border-gray-700 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100">Shortcode</h2>
                <button
                  type="button"
                  onClick={copyShortcode}
                  disabled={!shortcode}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="bg-gray-900 text-gray-100 rounded-lg p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                {shortcode || '// Select at least one page above'}
              </pre>
            </section>

            <section className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 border border-gray-200 dark:border-gray-700 space-y-3">
              <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100">Preview</h2>
              <p className="text-[11px] text-gray-400">
                Approximate rendering — actual styling depends on the theme's <code className="text-[11px]">zao_page_buttons</code> shortcode.
              </p>
              <div className="flex flex-wrap gap-2">
                {labelRows.map((row) => {
                  const page = pageById.get(row.id)
                  return (
                    <a
                      key={row.id}
                      href={page?.link || '#'}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center px-4 py-2 rounded-full bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
                    >
                      {row.cleaned || row.original}
                    </a>
                  )
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
