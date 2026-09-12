'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  Copy,
  Grid3x3,
  List,
  Loader2,
  MapPin,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'

import Header from '@/components/layout/Header'
import ModelSelect from '@/components/ui/ModelSelect'
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
const LAST_MODEL_KEY = 'zaoflo_city_buttons_last_model'
const LAST_STYLE_KEY = 'zaoflo_city_buttons_style'
const LAST_COUNTY_KEYWORDS_KEY = 'zaoflo_city_buttons_county_keywords'

const DEFAULT_BG = '#16a34a'
const DEFAULT_COLOR = '#ffffff'
const DEFAULT_OUTLINE = ''
const DEFAULT_SIZE = 14
const DEFAULT_OUTLINE_SIZE = 1

const MIN_OUTLINE_SIZE = 1
const MAX_OUTLINE_SIZE = 5

interface ButtonStyle {
  bg: string
  color: string
  outline: string
  size: number
  outlineSize: number
}

/** Accepts "#abc", "#aabbcc", or bare hex (with or without leading #). Empty
 *  string is a valid value for `outline` — it means "no outline". */
function isValidHex(value: string): boolean {
  if (value === '') return true
  return /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)
}

function normalizeHex(value: string): string {
  const v = value.trim()
  if (v === '') return ''
  return v.startsWith('#') ? v.toLowerCase() : `#${v.toLowerCase()}`
}

// Matches the server cap in /api/city-buttons/classify. The client walks
// the unclassified pages in slices of this size so a 700-page site shows
// incremental progress instead of a single 60-second stall.
const CLASSIFY_BATCH_SIZE = 50

interface CountyAssignment {
  county: string | null
  state: string | null
}

const UNCLASSIFIED_KEY = '__unclassified__'
const UNKNOWN_KEY = '__unknown__'

/** Stable key used for grouping and dropdown values — collapses null/empty
 *  states so "unknown" is a single bucket the user can filter to. */
function countyKey(a: CountyAssignment | undefined): string {
  if (!a) return UNCLASSIFIED_KEY
  if (!a.county) return UNKNOWN_KEY
  return `${a.county}||${a.state || ''}`
}

function countyLabel(key: string, a?: CountyAssignment): string {
  if (key === UNCLASSIFIED_KEY) return 'Unclassified'
  if (key === UNKNOWN_KEY) return 'Unknown / ambiguous'
  if (!a?.county) return 'Unknown / ambiguous'
  return a.state ? `${a.county}, ${a.state}` : a.county
}

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

/**
 * Native color wheel paired with a hex text input. The wheel always holds a
 * concrete color even when `value` is empty (outline defaults to black in that
 * case) so the picker stays usable — the text input is the source of truth for
 * whether the caller sees a value at all.
 */
function ColorField({
  label,
  value,
  onChange,
  clearable = false,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  clearable?: boolean
  hint?: string
}) {
  const wheelValue = value && isValidHex(value) ? normalizeHex(value) : '#000000'
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={wheelValue}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-11 rounded border border-gray-200 dark:border-gray-600 bg-transparent cursor-pointer"
          aria-label={`${label} picker`}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={clearable ? '(none)' : '#RRGGBB'}
          className="flex-1 px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-mono text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        {clearable && value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-[11px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-1"
            title="Clear"
          >
            Clear
          </button>
        )}
      </div>
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </div>
  )
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

  // Cached county assignments for the current site — keyed by wp page id.
  // Loaded from Supabase alongside the pages fetch; mutated in-place by the
  // classifier so progress lands live in the UI.
  const [counties, setCounties] = useState<Map<number, CountyAssignment>>(new Map())
  const [countiesLoading, setCountiesLoading] = useState(false)

  const [organizeOpen, setOrganizeOpen] = useState(false)
  const [model, setModel] = useState('')
  const [classifying, setClassifying] = useState(false)
  const [classifyDone, setClassifyDone] = useState(0)
  const [classifyTotal, setClassifyTotal] = useState(0)
  const [classifyError, setClassifyError] = useState<string | null>(null)

  const [countyFilter, setCountyFilter] = useState<string>('')
  const [countyKeywords, setCountyKeywords] = useState<string>('')

  const [bgColor, setBgColor] = useState<string>(DEFAULT_BG)
  const [fontColor, setFontColor] = useState<string>(DEFAULT_COLOR)
  const [outlineColor, setOutlineColor] = useState<string>(DEFAULT_OUTLINE)
  const [fontSize, setFontSize] = useState<number>(DEFAULT_SIZE)
  const [outlineSize, setOutlineSize] = useState<number>(DEFAULT_OUTLINE_SIZE)

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
    const savedModel = window.localStorage.getItem(LAST_MODEL_KEY)
    if (savedModel) setModel(savedModel)
    const savedKw = window.localStorage.getItem(LAST_COUNTY_KEYWORDS_KEY)
    if (savedKw) setCountyKeywords(savedKw)
    const savedStyle = window.localStorage.getItem(LAST_STYLE_KEY)
    if (savedStyle) {
      try {
        const parsed = JSON.parse(savedStyle) as Partial<ButtonStyle>
        if (typeof parsed.bg === 'string' && isValidHex(parsed.bg)) setBgColor(parsed.bg)
        if (typeof parsed.color === 'string' && isValidHex(parsed.color)) setFontColor(parsed.color)
        if (typeof parsed.outline === 'string' && isValidHex(parsed.outline)) setOutlineColor(parsed.outline)
        if (typeof parsed.size === 'number' && parsed.size > 0) setFontSize(parsed.size)
        if (typeof parsed.outlineSize === 'number' && parsed.outlineSize >= MIN_OUTLINE_SIZE && parsed.outlineSize <= MAX_OUTLINE_SIZE) {
          setOutlineSize(parsed.outlineSize)
        }
      } catch {
        // Ignore malformed cache — user just gets defaults.
      }
    }
  }, [])

  useEffect(() => {
    if (!model || typeof window === 'undefined') return
    window.localStorage.setItem(LAST_MODEL_KEY, model)
  }, [model])

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
    if (typeof window === 'undefined') return
    window.localStorage.setItem(LAST_COUNTY_KEYWORDS_KEY, countyKeywords)
  }, [countyKeywords])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const payload: ButtonStyle = {
      bg: bgColor,
      color: fontColor,
      outline: outlineColor,
      size: fontSize,
      outlineSize,
    }
    window.localStorage.setItem(LAST_STYLE_KEY, JSON.stringify(payload))
  }, [bgColor, fontColor, outlineColor, fontSize, outlineSize])

  useEffect(() => {
    if (!siteId) {
      setPages([])
      setCounties(new Map())
      return
    }
    let cancelled = false
    setLoading(true)
    setCountiesLoading(true)
    setError(null)
    setSelectedIds([])
    setCountyFilter('')
    setCounties(new Map())

    // Kick off both fetches in parallel — county lookups are per-site and
    // small (a few KB even for 700 pages), so waiting on the WP fetch
    // before starting the Supabase read would just add latency.
    const pagesFetch = fetch(`/api/city-buttons/pages?site_id=${siteId}`)
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

    const countiesFetch = fetch(`/api/city-buttons/counties?site_id=${siteId}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (cancelled) return
        if (!ok) return
        const next = new Map<number, CountyAssignment>()
        for (const row of (d.counties || []) as Array<{ wp_page_id: number; county: string | null; state: string | null }>) {
          next.set(row.wp_page_id, { county: row.county, state: row.state })
        }
        setCounties(next)
      })
      .catch(() => {
        // Non-fatal — the picker still works without cached counties.
      })
      .finally(() => {
        if (!cancelled) setCountiesLoading(false)
      })

    return () => {
      cancelled = true
      void pagesFetch
      void countiesFetch
    }
  }, [siteId])

  const filteredPages = useMemo(() => {
    const q = query.trim().toLowerCase()
    // Keyword filter only kicks in when a county is picked — it's designed as a
    // narrower-within-scope tool, not a global search (the top box already fills
    // that role).
    const kw = countyFilter ? countyKeywords.trim().toLowerCase() : ''
    return pages.filter((p) => {
      if (countyFilter) {
        const key = countyKey(counties.get(p.id))
        if (key !== countyFilter) return false
      }
      if (kw) {
        const t = (p.title || '').toLowerCase()
        const s = (p.slug || '').toLowerCase()
        if (!t.includes(kw) && !s.includes(kw)) return false
      }
      if (!q) return true
      return (
        (p.title || '').toLowerCase().includes(q) ||
        (p.slug || '').toLowerCase().includes(q)
      )
    })
  }, [pages, query, countyFilter, countyKeywords, counties])

  // Grouped counts for the filter dropdown. Sorted by size desc so the
  // biggest bucket ("Los Angeles County, 55") floats to the top and the
  // long tail of one-off assignments falls to the bottom, but with
  // "Unclassified" always pinned last so it doesn't drown the useful entries.
  const countyOptions = useMemo(() => {
    const counts = new Map<string, { count: number; sample: CountyAssignment | undefined }>()
    for (const p of pages) {
      const a = counties.get(p.id)
      const key = countyKey(a)
      const prev = counts.get(key)
      if (prev) prev.count += 1
      else counts.set(key, { count: 1, sample: a })
    }
    return Array.from(counts.entries())
      .map(([key, { count, sample }]) => ({ key, count, label: countyLabel(key, sample) }))
      .sort((a, b) => {
        if (a.key === UNCLASSIFIED_KEY) return 1
        if (b.key === UNCLASSIFIED_KEY) return -1
        if (a.key === UNKNOWN_KEY) return 1
        if (b.key === UNKNOWN_KEY) return -1
        if (b.count !== a.count) return b.count - a.count
        return a.label.localeCompare(b.label)
      })
  }, [pages, counties])

  const unclassifiedCount = useMemo(
    () => pages.reduce((n, p) => (counties.has(p.id) ? n : n + 1), 0),
    [pages, counties],
  )

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

  // When a county filter is active, scope the label list (and by extension the
  // shortcode and preview) to selections in that county. Otherwise a workflow
  // like "filter County A, select all → filter County B, select all" produces
  // one giant cross-county shortcode, which defeats the point of grouping.
  // Selections from other counties are kept in state so clearing the filter
  // brings them back — nothing is silently dropped.
  const scopedSelectedPages = useMemo(() => {
    if (!countyFilter) return selectedPages
    return selectedPages.filter((p) => countyKey(counties.get(p.id)) === countyFilter)
  }, [selectedPages, countyFilter, counties])

  // Any selection whose label collapsed to nothing after stripping would emit
  // an empty pipe segment — surface those so the user can adjust the words
  // rather than shipping a blank button.
  const labelRows = useMemo(
    () => scopedSelectedPages.map((p) => ({
      id: p.id,
      original: p.title,
      cleaned: cleanLabel(p.title, excludedWords),
    })),
    [scopedSelectedPages, excludedWords],
  )

  const hasEmptyLabels = labelRows.some((r) => !r.cleaned)

  const shortcode = useMemo(() => {
    if (labelRows.length === 0) return ''
    const ids = labelRows.map((r) => r.id).join(',')
    const labels = labelRows.map((r) => r.cleaned || r.original).join('|')
    const parts = [`ids="${ids}"`, `labels="${labels}"`]
    if (bgColor) parts.push(`bg="${normalizeHex(bgColor)}"`)
    if (fontColor) parts.push(`color="${normalizeHex(fontColor)}"`)
    if (outlineColor) {
      parts.push(`outline="${normalizeHex(outlineColor)}"`)
      parts.push(`outline_size="${outlineSize}"`)
    }
    if (fontSize) parts.push(`size="${fontSize}"`)
    return `[zaoflow_page_buttons ${parts.join(' ')}]`
  }, [labelRows, bgColor, fontColor, outlineColor, fontSize, outlineSize])

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

  /**
   * Walk every unclassified page for the current site in batches of
   * CLASSIFY_BATCH_SIZE, calling /api/city-buttons/classify sequentially so
   * progress lands live and a mid-run failure can be resumed by just
   * clicking Run again (already-classified pages are skipped).
   */
  async function runClassifier() {
    if (!siteId || !model || classifying) return
    const targets = pages.filter((p) => !counties.has(p.id))
    if (targets.length === 0) {
      toast.success('All pages already classified')
      return
    }

    setClassifying(true)
    setClassifyError(null)
    setClassifyDone(0)
    setClassifyTotal(targets.length)

    try {
      for (let i = 0; i < targets.length; i += CLASSIFY_BATCH_SIZE) {
        const slice = targets.slice(i, i + CLASSIFY_BATCH_SIZE)
        const res = await fetch('/api/city-buttons/classify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            site_id: siteId,
            model,
            pages: slice.map((p) => ({ id: p.id, title: p.title, slug: p.slug })),
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || `Classifier failed at batch ${Math.floor(i / CLASSIFY_BATCH_SIZE) + 1}`)

        const results = (data.results || []) as Array<{ id: number; county: string | null; state: string | null }>
        setCounties((prev) => {
          const next = new Map(prev)
          for (const r of results) next.set(r.id, { county: r.county, state: r.state })
          return next
        })
        setClassifyDone((n) => n + slice.length)
      }
      toast.success(`Classified ${targets.length} page${targets.length === 1 ? '' : 's'}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setClassifyError(msg)
      toast.error(msg)
    } finally {
      setClassifying(false)
    }
  }

  function selectAllInCountyFilter() {
    if (!countyFilter) return
    const kw = countyKeywords.trim().toLowerCase()
    setSelectedIds((prev) => {
      const seen = new Set(prev)
      const next = [...prev]
      for (const p of pages) {
        if (countyKey(counties.get(p.id)) !== countyFilter) continue
        if (kw) {
          const t = (p.title || '').toLowerCase()
          const s = (p.slug || '').toLowerCase()
          if (!t.includes(kw) && !s.includes(kw)) continue
        }
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Filter by county
              </label>
              <div className="flex gap-2">
                <select
                  value={countyFilter}
                  onChange={(e) => setCountyFilter(e.target.value)}
                  disabled={pages.length === 0}
                  className="flex-1 px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
                >
                  <option value="">
                    {countiesLoading ? 'Loading counties…' : `All counties (${pages.length})`}
                  </option>
                  {countyOptions.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label} ({opt.count})
                    </option>
                  ))}
                </select>
                {countyFilter && (
                  <button
                    type="button"
                    onClick={() => setCountyFilter('')}
                    className="px-2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                    title="Clear county filter"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {countyFilter && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Keywords in {countyOptions.find((o) => o.key === countyFilter)?.label || 'this county'}
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={countyKeywords}
                  onChange={(e) => setCountyKeywords(e.target.value)}
                  placeholder="web design"
                  className="w-full pl-9 pr-8 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                {countyKeywords && (
                  <button
                    type="button"
                    aria-label="Clear keywords"
                    onClick={() => setCountyKeywords('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                Narrow within the selected county — matches anywhere in the page title or slug.
              </p>
            </div>
          )}

          <div className="pt-3 border-t border-gray-100 dark:border-gray-700">
            <button
              type="button"
              onClick={() => setOrganizeOpen((v) => !v)}
              disabled={pages.length === 0}
              className="inline-flex items-center gap-2 text-sm font-medium text-brand-700 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <MapPin className="w-4 h-4" />
              {organizeOpen ? 'Hide' : 'Organize'} by county
              {counties.size > 0 && (
                <span className="text-[11px] font-normal text-gray-500 dark:text-gray-400">
                  · {counties.size} of {pages.length} classified
                </span>
              )}
            </button>

            {organizeOpen && (
              <div className="mt-3 space-y-3 rounded-lg border border-gray-100 dark:border-gray-700 p-3 bg-gray-50/60 dark:bg-gray-900/30">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Ask an AI to bucket each page by US county from its title. Cached per page — re-runs only touch new pages.
                </p>
                <ModelSelect
                  value={model}
                  onChange={setModel}
                  lastModelKey={LAST_MODEL_KEY}
                  variant="compact"
                  action={
                    <button
                      type="button"
                      onClick={runClassifier}
                      disabled={!model || classifying || unclassifiedCount === 0}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {classifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      {classifying
                        ? `Classifying… ${classifyDone}/${classifyTotal}`
                        : unclassifiedCount === 0
                          ? 'All classified'
                          : `Classify ${unclassifiedCount}`}
                    </button>
                  }
                />
                {classifying && (
                  <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                    <div
                      className="h-full bg-brand-600 transition-all"
                      style={{
                        width: `${classifyTotal > 0 ? Math.round((classifyDone / classifyTotal) * 100) : 0}%`,
                      }}
                    />
                  </div>
                )}
                {classifyError && (
                  <p className="text-xs text-red-600 dark:text-red-400">{classifyError}</p>
                )}
              </div>
            )}
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
                  <strong>{countyFilter ? scopedSelectedPages.length : selectedIds.length}</strong> selected
                  <span className="text-gray-500 dark:text-gray-400">
                    {' '}of {countyFilter ? filteredPages.length : pages.length}
                    {countyFilter && scopedSelectedPages.length !== selectedIds.length && (
                      <> · {selectedIds.length - scopedSelectedPages.length} hidden in other counties</>
                    )}
                  </span>
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
              {countyFilter && (
                <button
                  type="button"
                  onClick={selectAllInCountyFilter}
                  className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
                >
                  Select all in {countyOptions.find((o) => o.key === countyFilter)?.label || 'county'}
                  {countyKeywords.trim() && ` matching "${countyKeywords.trim()}"`}
                </button>
              )}
              {!countyFilter && filteredPages.length > 0 && (
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
                const assign = counties.get(p.id)
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
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 pr-6 line-clamp-2">
                      {p.title || p.slug}
                    </div>
                    <div className="space-y-0.5">
                      {assign?.county && (
                        <div className="inline-flex items-center gap-1 text-[10px] font-medium text-brand-700 dark:text-brand-400 bg-brand-100 dark:bg-brand-900/40 px-1.5 py-0.5 rounded max-w-full">
                          <MapPin className="w-2.5 h-2.5 shrink-0" />
                          <span className="truncate">{countyLabel(countyKey(assign), assign)}</span>
                        </div>
                      )}
                      <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                        {p.slug}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {filteredPages.map((p) => {
                const checked = selectedIds.includes(p.id)
                const assign = counties.get(p.id)
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
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate flex items-center gap-2">
                          <span className="truncate">{p.link || `/${p.slug}`}</span>
                        </div>
                      </div>
                      {assign?.county && (
                        <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-brand-700 dark:text-brand-400 bg-brand-100 dark:bg-brand-900/40 px-2 py-0.5 rounded shrink-0 max-w-[220px]">
                          <MapPin className="w-3 h-3 shrink-0" />
                          <span className="truncate">{countyLabel(countyKey(assign), assign)}</span>
                        </span>
                      )}
                      <span className="text-[11px] text-gray-400 shrink-0">#{p.id}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {scopedSelectedPages.length > 0 && (
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

            <section className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 border border-gray-200 dark:border-gray-700 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100">Button styling</h2>
                <button
                  type="button"
                  onClick={() => {
                    setBgColor(DEFAULT_BG)
                    setFontColor(DEFAULT_COLOR)
                    setOutlineColor(DEFAULT_OUTLINE)
                    setFontSize(DEFAULT_SIZE)
                    setOutlineSize(DEFAULT_OUTLINE_SIZE)
                  }}
                  className="text-[11px] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                >
                  Reset
                </button>
              </div>
              <p className="text-[11px] text-gray-400">
                Font family always inherits the theme's paragraph text.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <ColorField
                  label="Button color"
                  value={bgColor}
                  onChange={setBgColor}
                />
                <ColorField
                  label="Font color"
                  value={fontColor}
                  onChange={setFontColor}
                />
                <ColorField
                  label="Outline color"
                  value={outlineColor}
                  onChange={setOutlineColor}
                  clearable
                  hint="Leave blank for no outline."
                />
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Outline size (px)
                  </label>
                  <input
                    type="number"
                    min={MIN_OUTLINE_SIZE}
                    max={MAX_OUTLINE_SIZE}
                    value={outlineSize}
                    disabled={!outlineColor}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10)
                      if (Number.isNaN(n)) return
                      const clamped = Math.min(MAX_OUTLINE_SIZE, Math.max(MIN_OUTLINE_SIZE, n))
                      setOutlineSize(clamped)
                    }}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">
                    {outlineColor ? `${MIN_OUTLINE_SIZE}–${MAX_OUTLINE_SIZE} px` : 'Pick an outline color first.'}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Font size (px)
                  </label>
                  <input
                    type="number"
                    min={8}
                    max={64}
                    value={fontSize}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10)
                      if (!Number.isNaN(n)) setFontSize(n)
                    }}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              </div>
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
                On the live site, buttons render via the Zaoflo Connector plugin (v1.1+) and inherit the theme's paragraph font.
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
                      className="inline-flex items-center px-4 py-2 rounded-full font-medium transition-opacity hover:opacity-85"
                      style={{
                        backgroundColor: bgColor || undefined,
                        color: fontColor || undefined,
                        border: outlineColor ? `${outlineSize}px solid ${outlineColor}` : undefined,
                        fontSize: `${fontSize}px`,
                      }}
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
