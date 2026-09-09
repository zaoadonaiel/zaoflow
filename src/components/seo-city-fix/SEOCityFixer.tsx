'use client'

import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronDown, ExternalLink, LayoutGrid, List, Loader2, Search, Sparkles, Wand2, XCircle } from 'lucide-react'
import toast from 'react-hot-toast'

import Header from '@/components/layout/Header'
import Modal from '@/components/ui/Modal'
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
 * floats to the top and one-off titles sink.
 */
function extractCityCandidates(titles: string[]): { display: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const raw of titles) {
    if (!raw?.trim()) continue
    const words = raw
      .trim()
      .split(/\s+/)
      .filter((w) => !/^\d+$/.test(w))
      .map(titleWord)
    for (let n = 1; n <= Math.min(3, words.length); n++) {
      const cand = words.slice(0, n).join(' ')
      if (!/[A-Za-z]/.test(cand)) continue
      counts.set(cand, (counts.get(cand) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([display, count]) => ({ display, count }))
    .sort((a, b) => (b.count - a.count) || a.display.localeCompare(b.display))
}

/**
 * Count how many spellings of the source city appear in one field. Matches
 * every form the Fix will rewrite — display, lowercase, uppercase, slug
 * (`la-habra`), space-stripped (`lahabra`) and single-letter deletion typos.
 * The number shown to the user next to each row is meant to answer
 * "will this field change?" without them having to read the whole diff.
 */
function countMatches(value: string, city: string): number {
  if (!value || !city.trim()) return 0
  const parsed = parseCity(city)
  const stripped = parsed.display.replace(/\s+/g, '')
  const variants = new Set<string>()
  if (parsed.display) {
    variants.add(parsed.display)
    variants.add(parsed.display.toLowerCase())
  }
  if (parsed.displaySlug) variants.add(parsed.displaySlug)
  if (parsed.slug) variants.add(parsed.slug)
  if (stripped.length >= 3) variants.add(stripped)

  let total = 0
  for (const v of variants) {
    if (!v) continue
    const re = new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    total += (value.match(re) || []).length
  }
  return total
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
  const [applying, setApplying] = useState(false)
  const [lastLink, setLastLink] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<{
    changedFields: string[]
    total: number
    link: string | null
  } | null>(null)

  // Modal that hosts the search field, per-field match list and Fix button.
  // Opens when the user clicks the "Open fixer" button after picking a page.
  const [modalOpen, setModalOpen] = useState(false)

  // Picker modal for choosing which WordPress page to fix. Replaces the long
  // dropdown so the user can search by title or URL instead of scrolling.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')

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
    setLastUpdate(null)
    setModalOpen(false)
  }, [siteId, kind])

  // Fetch the full page (content + Yoast) whenever the picked id changes.
  useEffect(() => {
    if (!siteId || !pageId) {
      setPage(null)
      return
    }
    let cancelled = false
    setPageLoading(true)
    setLastUpdate(null)
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

  // Pre-compute city candidates from every page title on this site.
  const cityCandidates = useMemo(
    () => extractCityCandidates(wpPages.map((p) => p.title || p.slug || '')),
    [wpPages],
  )

  // Auto-populate the canonical city from the picked page's title, so the
  // search field already contains a sensible starting value when the modal
  // opens. Only fills when the user hasn't typed anything.
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

  const previews = useMemo(() => {
    if (!page || !city.trim()) return null
    const parsed = parseCity(city)
    return FIELDS.map((spec) => {
      const before = String((page as unknown as Record<string, unknown>)[spec.key] ?? '')
      const after = fixField(spec, before, parsed.display)
      return {
        spec,
        before,
        after,
        changed: before !== after,
        size: changeSize(before, after),
        matches: countMatches(before, city),
      }
    })
  }, [page, city])

  const totalChanges = previews?.reduce((n, p) => n + (p.changed ? 1 : 0), 0) ?? 0
  const totalMatches = previews?.reduce((n, p) => n + p.matches, 0) ?? 0
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
        setLastUpdate({ changedFields: [], total: 0, link: page?.link || null })
      } else {
        const changedFields = Object.entries(data.changed || {})
          .filter(([, v]) => v)
          .map(([k]) => FIELDS.find((f) => f.key === k)?.label || k)
        toast.success(`Fixed and pushed to WordPress`)
        setLastLink(data.link || null)
        setLastUpdate({ changedFields, total: changedFields.length, link: data.link || null })
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

  const pickedPageOption = pageId ? wpPages.find((p) => p.id === pageId) : null

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
            <button
              type="button"
              onClick={() => {
                setPickerQuery('')
                setPickerOpen(true)
              }}
              disabled={!siteId || wpPagesLoading || wpPages.length === 0}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-left text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <span className="truncate min-w-0">
                {pickedPageOption
                  ? <><span className="font-medium">{pickedPageOption.title || pickedPageOption.slug}</span> <span className="text-gray-500 dark:text-gray-400">— /{pickedPageOption.slug}</span></>
                  : !siteId
                    ? 'Pick a site first'
                    : wpPagesLoading
                      ? `Loading ${kind}s…`
                      : wpPages.length === 0
                        ? `No ${kind}s found`
                        : `Search ${wpPages.length} ${kind}${wpPages.length === 1 ? '' : 's'}…`}
              </span>
              <span className="shrink-0 inline-flex items-center gap-1 text-gray-400">
                <Search className="w-4 h-4" />
                <ChevronDown className="w-4 h-4" />
              </span>
            </button>
            {wpPagesError && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{wpPagesError}</p>}
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
              Search by title or URL, pick a {kind}, then click <span className="font-medium">Open fixer</span> to review the fields and push the change.
            </p>
          </div>

          {pageId && page && !modalOpen && (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700"
              >
                <Sparkles className="w-4 h-4" /> Open fixer for “{page.title || page.slug}”
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
            </div>
          )}

          {pageLoading && (
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading page from WordPress…
            </div>
          )}
        </section>
      </div>

      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        maxWidth="max-w-6xl"
        title={
          <span className="flex items-center gap-2 min-w-0">
            <Search className="w-4 h-4 text-brand-500 shrink-0" />
            <span className="truncate">Pick a {kind} to fix</span>
            <span className="text-xs font-normal text-gray-500 dark:text-gray-400 shrink-0">
              ({wpPages.length})
            </span>
          </span>
        }
      >
        <PagePicker
          pages={wpPages}
          query={pickerQuery}
          onQueryChange={setPickerQuery}
          selectedId={pageId}
          onPick={(id) => {
            setPageId(id)
            setPickerOpen(false)
          }}
          kind={kind}
        />
      </Modal>

      <Modal
        open={modalOpen && !!page}
        onClose={() => setModalOpen(false)}
        maxWidth="max-w-3xl"
        title={
          <span className="flex items-center gap-2 min-w-0">
            <Sparkles className="w-4 h-4 text-brand-500 shrink-0" />
            <span className="truncate">{page?.title || pickedPageOption?.title || 'Fix city'}</span>
          </span>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Canonical city name — every variant (“la-habra”, “LAHABRA”, “La-Habra”, typos) is rewritten to this
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. La Habra"
                autoFocus
                className="w-full pl-9 pr-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            {cityCandidates.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {cityCandidates.slice(0, 8).map(({ display, count }) => {
                  const active = city.trim().toLowerCase() === display.toLowerCase()
                  return (
                    <button
                      key={display}
                      type="button"
                      onClick={() => setCity(display)}
                      className={`px-2 py-0.5 rounded-full text-[11px] border transition-colors ${
                        active
                          ? 'bg-brand-600 text-white border-brand-600'
                          : 'bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'
                      }`}
                    >
                      {display} <span className="opacity-60">· {count}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-200">Fields on this page</span>
              <span className="text-[11px] text-gray-500 dark:text-gray-400">
                {city.trim()
                  ? `${totalMatches} match${totalMatches === 1 ? '' : 'es'} · ${totalChanges} field${totalChanges === 1 ? '' : 's'} will change`
                  : 'Type a city to scan the fields'}
              </span>
            </div>

            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {(previews || FIELDS.map((spec) => ({
                spec,
                before: String((page as unknown as Record<string, unknown> | null)?.[spec.key] ?? ''),
                after: '',
                changed: false,
                size: 0,
                matches: 0,
              }))).map(({ spec, before, after, changed, size, matches }) => (
                <li key={spec.key} className="px-3 py-2">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      {changed ? (
                        <CheckCircle2 className="w-4 h-4 text-amber-500" />
                      ) : before.trim() ? (
                        <XCircle className="w-4 h-4 text-gray-300 dark:text-gray-600" />
                      ) : (
                        <XCircle className="w-4 h-4 text-gray-200 dark:text-gray-700" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">
                          {spec.label}
                        </span>
                        <span
                          className={`text-[11px] shrink-0 ${
                            changed
                              ? 'text-amber-700 dark:text-amber-300'
                              : matches > 0
                                ? 'text-gray-500 dark:text-gray-400'
                                : 'text-gray-400'
                          }`}
                        >
                          {city.trim()
                            ? changed
                              ? `${matches} match${matches === 1 ? '' : 'es'} · ${size} char${size === 1 ? '' : 's'} change`
                              : matches > 0
                                ? `${matches} already canonical`
                                : before.trim()
                                  ? 'no match'
                                  : '(empty)'
                            : before.trim() ? `${before.replace(/<[^>]+>/g, '').length} chars` : '(empty)'}
                        </span>
                      </div>
                      {changed && (
                        <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                          <div>
                            <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Before</div>
                            <pre className="whitespace-pre-wrap break-words text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/40 rounded p-2 border border-gray-200 dark:border-gray-700 max-h-32 overflow-auto">
{preview(before, spec.isHtml)}
                            </pre>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">After</div>
                            <pre className="whitespace-pre-wrap break-words text-gray-800 dark:text-gray-100 bg-amber-50/40 dark:bg-amber-900/10 rounded p-2 border border-amber-300 dark:border-amber-700 max-h-32 overflow-auto">
{preview(after, spec.isHtml)}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {lastUpdate && (
            <div
              className={`rounded-lg border px-3 py-2 text-xs ${
                lastUpdate.total > 0
                  ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-200'
                  : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40 text-gray-600 dark:text-gray-300'
              }`}
            >
              {lastUpdate.total > 0 ? (
                <>
                  Pushed <strong>{lastUpdate.total}</strong> field
                  {lastUpdate.total === 1 ? '' : 's'} to WordPress:{' '}
                  {lastUpdate.changedFields.join(', ')}.
                </>
              ) : (
                <>No changes were needed — every reference already uses the canonical spelling.</>
              )}
              {lastUpdate.link && (
                <>
                  {' '}
                  <a
                    href={lastUpdate.link}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 underline"
                  >
                    View the live page <ExternalLink className="w-3 h-3" />
                  </a>
                </>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              URL slug is left alone — changing a slug would break inbound links.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                Close
              </button>
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
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}

const PICKER_VIEW_KEY = 'zaoflo_city_fix_picker_view'

/** Searchable list/grid of WordPress pages/posts shown inside the picker
 *  modal. Matches title and slug/URL against the query so users can find a
 *  page without scrolling the full list. View mode (list vs. grid) persists
 *  across sessions in localStorage. */
function PagePicker({
  pages,
  query,
  onQueryChange,
  selectedId,
  onPick,
  kind,
}: {
  pages: WPPageOption[]
  query: string
  onQueryChange: (q: string) => void
  selectedId: number | null
  onPick: (id: number) => void
  kind: 'post' | 'page'
}) {
  const [view, setView] = useState<'list' | 'grid'>(() => {
    if (typeof window === 'undefined') return 'list'
    return (window.localStorage.getItem(PICKER_VIEW_KEY) as 'list' | 'grid') || 'list'
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(PICKER_VIEW_KEY, view)
  }, [view])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return pages
    return pages.filter((p) => {
      const title = (p.title || '').toLowerCase()
      const slug = (p.slug || '').toLowerCase()
      const link = (p.link || '').toLowerCase()
      return title.includes(q) || slug.includes(q) || link.includes(q)
    })
  }, [pages, q])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={`Search ${pages.length} ${kind}${pages.length === 1 ? '' : 's'} by title or URL…`}
            autoFocus
            className="w-full pl-9 pr-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 shrink-0">
          <button
            type="button"
            onClick={() => setView('list')}
            aria-label="List view"
            aria-pressed={view === 'list'}
            title="List view"
            className={`px-2.5 py-2 transition-colors ${
              view === 'list'
                ? 'bg-brand-600 text-white'
                : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
            }`}
          >
            <List className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setView('grid')}
            aria-label="Grid view"
            aria-pressed={view === 'grid'}
            title="Grid view"
            className={`px-2.5 py-2 transition-colors ${
              view === 'grid'
                ? 'bg-brand-600 text-white'
                : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="text-[11px] text-gray-500 dark:text-gray-400">
        {q
          ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'} of ${pages.length}`
          : `${pages.length} ${kind}${pages.length === 1 ? '' : 's'}`}
      </div>

      {filtered.length === 0 ? (
        <div className="px-3 py-10 text-center text-sm text-gray-500 dark:text-gray-400 rounded-lg border border-gray-200 dark:border-gray-700">
          No {kind}s match “{query}”.
        </div>
      ) : view === 'list' ? (
        <ul className="max-h-[70vh] overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700 rounded-lg border border-gray-200 dark:border-gray-700">
          {filtered.map((p) => {
            const isSelected = p.id === selectedId
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onPick(p.id)}
                  className={`w-full text-left px-3 py-2 flex flex-col gap-0.5 transition-colors ${
                    isSelected
                      ? 'bg-brand-50 dark:bg-brand-900/30'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700/60'
                  }`}
                >
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {p.title || p.slug}
                  </span>
                  <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                    {p.link || `/${p.slug}`}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="max-h-[70vh] overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 p-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {filtered.map((p) => {
              const isSelected = p.id === selectedId
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onPick(p.id)}
                  className={`text-left p-3 rounded-lg border transition-colors flex flex-col gap-1 ${
                    isSelected
                      ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-400 dark:border-brand-500'
                      : 'bg-gray-50 dark:bg-gray-700/40 border-gray-200 dark:border-gray-600 hover:bg-white dark:hover:bg-gray-700 hover:border-brand-300 dark:hover:border-brand-600'
                  }`}
                >
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-2">
                    {p.title || p.slug}
                  </span>
                  <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate mt-auto">
                    {p.link || `/${p.slug}`}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
