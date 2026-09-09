'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ExternalLink, Loader2, Search, Sparkles, Wand2 } from 'lucide-react'
import toast from 'react-hot-toast'

import Header from '@/components/layout/Header'
import {
  parseCity,
  enforceCityDisplayInHtml,
  enforceCityDisplayInText,
} from '@/lib/seo-city-swap'
import type { Site, WPPageOption } from '@/types'

/** WordPress post shape as the SEO wp-pages endpoint returns it for a single page. */
interface WPPageFullClient {
  id: number
  slug: string
  title: string
  link: string
  content: string
  excerpt: string
  yoastTitle?: string
  yoastMetaDescription?: string
  focusKeyphrase?: string
  keyphraseSynonyms?: string
}

type FieldKey =
  | 'title'
  | 'yoastTitle'
  | 'yoastMetaDescription'
  | 'focusKeyphrase'
  | 'keyphraseSynonyms'
  | 'excerpt'
  | 'content'

interface FieldSpec {
  key: FieldKey
  label: string
  /** HTML fields keep their tags in the diff; text fields don't. */
  isHtml: boolean
}

const FIELDS: FieldSpec[] = [
  { key: 'title', label: 'Post title', isHtml: false },
  { key: 'yoastTitle', label: 'Yoast SEO title', isHtml: false },
  { key: 'yoastMetaDescription', label: 'Yoast meta description', isHtml: false },
  { key: 'focusKeyphrase', label: 'Focus keyphrase', isHtml: false },
  { key: 'keyphraseSynonyms', label: 'Keyphrase synonyms', isHtml: false },
  { key: 'excerpt', label: 'Excerpt', isHtml: true },
  { key: 'content', label: 'Body content (H1, H2, paragraphs, block attrs)', isHtml: true },
]

const LAST_SITE_KEY = 'zaoflo_city_fix_last_site_id'

function fixField(spec: FieldSpec, value: string, cityDisplay: string): string {
  if (!value || !cityDisplay.trim()) return value
  const parsed = parseCity(cityDisplay)
  return spec.isHtml
    ? enforceCityDisplayInHtml(value, parsed)
    : enforceCityDisplayInText(value, parsed)
}

/** Count how many characters differ — cheap way to show "N chars changed"
 *  without a real diff library. Zero means "field unchanged". */
function changeSize(before: string, after: string): number {
  if (before === after) return 0
  const len = Math.min(before.length, after.length)
  let diffs = Math.abs(before.length - after.length)
  for (let i = 0; i < len; i++) if (before[i] !== after[i]) diffs += 1
  return diffs
}

/** Trim a long HTML/text value so the preview stays readable. */
function preview(value: string, isHtml: boolean, limit = 800): string {
  const text = isHtml ? value.replace(/\s+/g, ' ').trim() : value.trim()
  return text.length > limit ? text.slice(0, limit) + ' …' : text
}

/** Title-case a word — capitalises the first letter, keeps the rest as-is,
 *  so acronyms embedded in a page title (e.g. "USA", "LA") don't get
 *  destroyed. Fine for typical city names. */
function titleWord(word: string): string {
  if (!word) return word
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/**
 * Guess the set of city-name candidates for a WP site by taking the first
 * 1–3 words of every page title. Deduped and ranked by how many pages start
 * with each candidate — so a shared city ("La Habra" across ten pages)
 * floats to the top and one-off titles sink. The user still edits the value
 * freely; the list is only a shortcut.
 */
function extractCityCandidates(titles: string[]): { display: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const raw of titles) {
    if (!raw?.trim()) continue
    // Ignore trailing digit-only tokens like "La Habra 2" — WP appends those
    // as duplicate-slug counters, not part of the city.
    const words = raw
      .trim()
      .split(/\s+/)
      .filter((w) => !/^\d+$/.test(w))
      .map(titleWord)
    for (let n = 1; n <= Math.min(3, words.length); n++) {
      const cand = words.slice(0, n).join(' ')
      // Skip candidates ending in a bare hyphen/dash or with no letters.
      if (!/[A-Za-z]/.test(cand)) continue
      counts.set(cand, (counts.get(cand) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([display, count]) => ({ display, count }))
    .sort((a, b) => (b.count - a.count) || a.display.localeCompare(b.display))
}

export default function SEOCityFixer() {
  const [sites, setSites] = useState<Site[]>([])
  const [sitesLoading, setSitesLoading] = useState(true)
  const [siteId, setSiteId] = useState<string>('')

  const [kind, setKind] = useState<'post' | 'page'>('page')
  const [wpPages, setWpPages] = useState<WPPageOption[]>([])
  const [wpPagesLoading, setWpPagesLoading] = useState(false)
  const [wpPagesError, setWpPagesError] = useState<string | null>(null)
  const [pageId, setPageId] = useState<number | null>(null)

  const [pageLoading, setPageLoading] = useState(false)
  const [page, setPage] = useState<WPPageFullClient | null>(null)

  const [city, setCity] = useState('')
  const [cityOpen, setCityOpen] = useState(false)
  const cityBoxRef = useRef<HTMLDivElement | null>(null)
  const [applying, setApplying] = useState(false)
  const [lastLink, setLastLink] = useState<string | null>(null)

  // Load WordPress sites once.
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

  // Load the WP page list when the site + kind changes.
  useEffect(() => {
    if (!siteId) {
      setWpPages([])
      setPageId(null)
      setPage(null)
      return
    }
    let cancelled = false
    setWpPagesLoading(true)
    setWpPagesError(null)
    fetch(`/api/seo-pages/wp-pages?site_id=${siteId}&kind=${kind}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (cancelled) return
        if (!ok) throw new Error(d?.error || `Failed to load WordPress ${kind}s`)
        setWpPages(d.pages || [])
      })
      .catch((err) => {
        if (cancelled) return
        setWpPages([])
        setWpPagesError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setWpPagesLoading(false)
      })
    return () => { cancelled = true }
  }, [siteId, kind])

  // Reset the picked page when the site or kind changes.
  useEffect(() => {
    setPageId(null)
    setPage(null)
    setLastLink(null)
  }, [siteId, kind])

  // Fetch the full page (content + Yoast) whenever the picked id changes.
  useEffect(() => {
    if (!siteId || !pageId) {
      setPage(null)
      return
    }
    let cancelled = false
    setPageLoading(true)
    fetch(`/api/seo-pages/wp-pages?site_id=${siteId}&page_id=${pageId}&kind=${kind}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (cancelled) return
        if (!ok) throw new Error(d?.error || 'Failed to load the WordPress page')
        setPage(d.page as WPPageFullClient)
      })
      .catch((err) => {
        if (cancelled) return
        toast.error(err instanceof Error ? err.message : 'Failed to load page')
        setPage(null)
      })
      .finally(() => {
        if (!cancelled) setPageLoading(false)
      })
    return () => { cancelled = true }
  }, [siteId, pageId, kind])

  // Close the city suggestion dropdown on any click outside it.
  useEffect(() => {
    if (!cityOpen) return
    function onDown(e: MouseEvent | TouchEvent) {
      if (!cityBoxRef.current) return
      if (!cityBoxRef.current.contains(e.target as Node)) setCityOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [cityOpen])

  // Pre-compute city candidates from every page title on this site, once per
  // wpPages change. Kept out of the render path so filtering feels instant
  // even for sites with a couple hundred pages.
  const cityCandidates = useMemo(
    () => extractCityCandidates(wpPages.map((p) => p.title || p.slug || '')),
    [wpPages],
  )

  // Auto-populate the canonical city from the picked page's title so the
  // Fix button becomes clickable right after picking a page — without
  // requiring the user to open the dropdown and pick a city manually.
  // Only fills when the user hasn't typed anything, so their manual input
  // is never overwritten by a page switch.
  useEffect(() => {
    if (!page) return
    setCity((prev) => {
      if (prev.trim()) return prev
      const title = page.title || ''
      const words = title
        .trim()
        .split(/\s+/)
        .filter((w) => !/^\d+$/.test(w))
        .map(titleWord)
      if (words.length === 0) return prev
      for (let n = Math.min(3, words.length); n >= 1; n--) {
        const cand = words.slice(0, n).join(' ')
        const found = cityCandidates.find(
          (c) => c.display.toLowerCase() === cand.toLowerCase(),
        )
        if (found) return found.display
      }
      return words.slice(0, Math.min(2, words.length)).join(' ')
    })
  }, [page, cityCandidates])

  const filteredCandidates = useMemo(() => {
    const q = city.trim().toLowerCase()
    if (!q) return cityCandidates.slice(0, 20)
    return cityCandidates
      .filter(({ display }) => display.toLowerCase().includes(q))
      .slice(0, 20)
  }, [cityCandidates, city])

  const previews = useMemo(() => {
    if (!page || !city.trim()) return null
    const parsed = parseCity(city)
    return FIELDS.map((spec) => {
      const before = String((page as unknown as Record<string, unknown>)[spec.key] ?? '')
      const after = fixField(spec, before, parsed.display)
      return { spec, before, after, changed: before !== after, size: changeSize(before, after) }
    })
  }, [page, city])

  const totalChanges = previews?.reduce((n, p) => n + (p.changed ? 1 : 0), 0) ?? 0
  const anyChanged = totalChanges > 0

  async function applyFix() {
    if (!siteId || !pageId || !city.trim()) return
    setApplying(true)
    try {
      const res = await fetch('/api/seo-city-fix/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: siteId, page_id: pageId, kind, city }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Fix failed')
      if (!data.updated) {
        toast(data.message || 'Nothing to fix — already clean.', { icon: 'ℹ️' })
      } else {
        toast.success(`Fixed and pushed to WordPress`)
        setLastLink(data.link || null)
        // Re-fetch so the preview reflects the freshly-saved state.
        const refresh = await fetch(`/api/seo-pages/wp-pages?site_id=${siteId}&page_id=${pageId}&kind=${kind}`)
        const rd = await refresh.json()
        if (refresh.ok) setPage(rd.page as WPPageFullClient)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fix failed')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div>
      <Header
        title="SEO City Fix"
        subtitle="Force one canonical spelling of a city across a WordPress page — title, H1/H2, body, Yoast fields."
      />

      <div className="max-w-4xl space-y-6">
        <section className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 border border-gray-200 dark:border-gray-700 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">WordPress site</label>
              <select
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                disabled={sitesLoading}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
              >
                <option value="">
                  {sitesLoading ? 'Loading sites…' : sites.length === 0 ? 'No WordPress sites — add one first' : 'Pick a site'}
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

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              {kind === 'page' ? 'Page' : 'Post'} to fix
              {wpPagesLoading && <Loader2 className="inline-block w-3 h-3 animate-spin ml-2" />}
            </label>
            <select
              value={pageId ?? ''}
              onChange={(e) => setPageId(e.target.value ? Number(e.target.value) : null)}
              disabled={!siteId || wpPagesLoading}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
            >
              <option value="">
                {!siteId
                  ? 'Pick a site first'
                  : wpPagesLoading
                    ? `Loading ${kind}s…`
                    : wpPages.length === 0
                      ? `No ${kind}s found`
                      : `Pick a ${kind} (${wpPages.length})`}
              </option>
              {wpPages.map((p) => (
                <option key={p.id} value={p.id}>{p.title || p.slug} — /{p.slug}</option>
              ))}
            </select>
            {wpPagesError && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{wpPagesError}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Canonical city name (exactly as it should appear)
            </label>
            <div ref={cityBoxRef} className="relative">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={city}
                  onChange={(e) => { setCity(e.target.value); setCityOpen(true) }}
                  onFocus={() => setCityOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setCityOpen(false); e.currentTarget.blur() }
                    if (e.key === 'Enter' && filteredCandidates.length === 1) {
                      setCity(filteredCandidates[0].display)
                      setCityOpen(false)
                      e.preventDefault()
                    }
                  }}
                  placeholder={cityCandidates.length > 0 ? 'Type or pick a city — e.g. La Habra' : 'Sunset Beach'}
                  className="w-full pl-9 pr-9 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <button
                  type="button"
                  onClick={() => setCityOpen((o) => !o)}
                  disabled={cityCandidates.length === 0}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-30"
                  title="Show suggestions"
                >
                  <ChevronDown className={`w-4 h-4 transition-transform ${cityOpen ? 'rotate-180' : ''}`} />
                </button>
              </div>

              {cityOpen && cityCandidates.length > 0 && (
                <div className="absolute z-20 left-0 right-0 mt-1 max-h-72 overflow-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg">
                  {filteredCandidates.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-gray-400">
                      No matches — “{city.trim()}” will still work as a free-text value.
                    </div>
                  ) : (
                    filteredCandidates.map(({ display, count }) => (
                      <button
                        key={display}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { setCity(display); setCityOpen(false) }}
                        className={`w-full flex items-center justify-between px-3 py-1.5 text-sm text-left transition-colors ${
                          city.trim().toLowerCase() === display.toLowerCase()
                            ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-200'
                            : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                        }`}
                      >
                        <span>{display}</span>
                        <span className="text-[11px] text-gray-400">{count} page{count === 1 ? '' : 's'}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              Suggestions pulled from the first 1–3 words of every {kind} title on this site. Matches all forms — “sunset beach”, “SUNSET BEACH”, “sunset-beach”, single-letter typos — and rewrites them to what you pick.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={applyFix}
              disabled={!siteId || !pageId || !city.trim() || applying || !anyChanged}
              className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              {applying
                ? 'Updating WordPress…'
                : anyChanged
                  ? `Fix ${totalChanges} field${totalChanges === 1 ? '' : 's'} on WordPress`
                  : previews
                    ? 'Nothing to fix — already clean'
                    : 'Fix on WordPress'}
            </button>
            {lastLink && (
              <a
                href={lastLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-brand-600 dark:text-brand-400 hover:underline"
              >
                Open the live page <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              URL slug is left alone — changing a slug would break inbound links.
            </p>
          </div>
        </section>

        {pageLoading && (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading page from WordPress…
          </div>
        )}

        {previews && (
          <section className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 border border-gray-200 dark:border-gray-700 space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-brand-500" />
              <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Preview</h2>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {anyChanged ? `${totalChanges} field${totalChanges === 1 ? '' : 's'} will change` : 'No changes needed'}
              </span>
            </div>

            <div className="space-y-4">
              {previews.map(({ spec, before, after, changed, size }) => (
                <div
                  key={spec.key}
                  className={`rounded-lg border p-3 ${
                    changed
                      ? 'border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-900/10'
                      : 'border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/20'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{spec.label}</span>
                    <span className={`text-[11px] ${changed ? 'text-amber-700 dark:text-amber-300' : 'text-gray-400'}`}>
                      {changed ? `${size} char${size === 1 ? '' : 's'} changed` : 'unchanged'}
                    </span>
                  </div>
                  {changed ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Before</div>
                        <pre className="whitespace-pre-wrap break-words text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 rounded p-2 border border-gray-200 dark:border-gray-700 max-h-40 overflow-auto">
{preview(before, spec.isHtml)}
                        </pre>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">After</div>
                        <pre className="whitespace-pre-wrap break-words text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-800 rounded p-2 border border-amber-300 dark:border-amber-700 max-h-40 overflow-auto">
{preview(after, spec.isHtml)}
                        </pre>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-gray-400">
                      {before.trim() ? 'No variants of the city found in this field.' : '(empty)'}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {page && !city.trim() && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Type the canonical city name above to see what will change.
          </p>
        )}
      </div>
    </div>
  )
}
