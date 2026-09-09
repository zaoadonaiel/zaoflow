'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Copy, Loader2, MapPin, Rocket, Save, Sparkles, Wand2, Calendar as CalendarIcon,
  ExternalLink, RefreshCw, ChevronDown, ChevronUp, Tag, Receipt,
} from 'lucide-react'
import toast from 'react-hot-toast'

import Header from '@/components/layout/Header'
import Modal from '@/components/ui/Modal'
import ArticleEditor from '@/components/articles/ArticleEditor'
import ImageGenerator from '@/components/articles/ImageGenerator'
import InstructionSets from '@/components/articles/InstructionSets'
import ModelSelect from '@/components/ui/ModelSelect'
import {
  parseCity,
  replaceCityInText,
  replaceCityInHtml,
  replaceCityInSlug,
  findReplaceInHtml,
  findReplaceInText,
} from '@/lib/seo-city-swap'
import type { ArticleInstruction, SEOPage, Site, SEOPageSimilarity, WPPageOption } from '@/types'

interface Props {
  /** Existing SEO page (edit mode) or null (new mode). */
  initial: SEOPage | null
  /** Sum of ai_usage.cost_usd for this SEO page, fetched by the parent. */
  initialCostTotal?: number
}

/** localStorage flag that lets the user skip the "are you sure" prompt on
 *  republish. Kept out of the DB — this is a per-browser preference. */
const SKIP_REPUBLISH_CONFIRM_KEY = 'zaoflo_seo_skip_republish_confirm'

const SIMILARITY_BUTTONS: { value: SEOPageSimilarity; label: string; hint: string }[] = [
  { value: 10, label: '10% similar', hint: 'Heavy rewrite — almost all words swapped' },
  { value: 25, label: '25% similar', hint: 'Substantial rewrite' },
  { value: 50, label: '50% similar', hint: 'About half the wording replaced' },
  { value: 90, label: '90% similar', hint: 'Light freshening — small tweaks only' },
]

export default function SEOPageBuilder({ initial, initialCostTotal = 0 }: Props) {
  const router = useRouter()

  const [savedId, setSavedId] = useState<string | null>(initial?.id ?? null)
  const [sites, setSites] = useState<Site[]>([])
  const [sitesLoading, setSitesLoading] = useState(true)
  const [siteId, setSiteId] = useState<string>(initial?.site_id || '')

  const [sourceKind, setSourceKind] = useState<'post' | 'page'>(initial?.source_kind ?? 'post')

  const [wpPages, setWpPages] = useState<WPPageOption[]>([])
  const [wpPagesLoading, setWpPagesLoading] = useState(false)
  const [wpPagesError, setWpPagesError] = useState<string | null>(null)

  const [sourcePageId, setSourcePageId] = useState<number | null>(initial?.source_page_id ?? null)
  const [sourceCity, setSourceCity] = useState(initial?.source_city || '')
  const [targetCity, setTargetCity] = useState(initial?.target_city || '')

  const [title, setTitle] = useState(initial?.title || '')
  const [slug, setSlug] = useState(initial?.slug || '')
  const [content, setContent] = useState(initial?.content || '')
  const [excerpt, setExcerpt] = useState(initial?.excerpt || '')

  const [featuredImageUrl, setFeaturedImageUrl] = useState(initial?.featured_image_url || '')
  const [featuredImagePrompt, setFeaturedImagePrompt] = useState(initial?.featured_image_prompt || '')
  const [featuredImageAlt, setFeaturedImageAlt] = useState(initial?.featured_image_alt || '')

  // Page Template captured from the source WP page (e.g. Avada's "100% Width"
  // or theme-specific slugs). Threaded through save + publish so the clone
  // renders in the same visual container as the source, instead of falling
  // back to the default template.
  const [sourceTemplate, setSourceTemplate] = useState<string>(initial?.source_template || '')

  // Ad-hoc find/replace state — for typos the city swap can't catch
  // (e.g. a source page that says "Los Angles" instead of "Los Angeles").
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')

  // Yoast SEO fields. Populated by the clone step with the source's values,
  // city-swapped. Never touched by the AI rewrite (it only rewrites `content`)
  // so what you see here is what publishes to WordPress.
  const [yoastTitle, setYoastTitle] = useState(initial?.yoast_title || '')
  const [yoastMetaDescription, setYoastMetaDescription] = useState(initial?.yoast_meta_description || '')
  const [focusKeyphrase, setFocusKeyphrase] = useState(initial?.focus_keyphrase || '')
  const [keyphraseSynonyms, setKeyphraseSynonyms] = useState(initial?.keyphrase_synonyms || '')
  // What the source page had for these fields, so the UI can show a
  // before/after comparison after cloning.
  const [sourceYoast, setSourceYoast] = useState<{
    title: string
    metaDescription: string
    focusKeyphrase: string
    keyphraseSynonyms: string
  } | null>(null)

  const [instructionSet, setInstructionSet] = useState<ArticleInstruction | null>(null)
  const [instructionId, setInstructionId] = useState<string | null>(initial?.instruction_id || null)
  const [model, setModel] = useState(initial?.ai_model || '')
  const [similarity, setSimilarity] = useState<SEOPageSimilarity | null>(initial?.rewrite_similarity ?? null)

  const [scheduledAt, setScheduledAt] = useState<string>(
    initial?.scheduled_at ? toLocalInputValue(initial.scheduled_at) : '',
  )

  // Live WP URL kept in local state so it appears the moment publish resolves,
  // without waiting for the /[id] route to re-fetch. Seeded from `initial` so
  // reopening a published page keeps the banner visible.
  const [wpPageUrl, setWpPageUrl] = useState<string | null>(initial?.wp_page_url ?? null)

  // Republish confirmation modal — shown when the page has been published
  // before (wpPageUrl is set) and the user hasn't chosen to skip the prompt.
  const [showRepublishConfirm, setShowRepublishConfirm] = useState(false)

  // Running total of what AI usage has cost against this page. Seeded from a
  // server aggregate on load (so re-opening a page shows history), then bumped
  // locally as each rewrite / image generation returns its cost.
  const [costTotal, setCostTotal] = useState<number>(initialCostTotal)

  // Defaults to true — the common case is to write `_location = 1`.
  const [setLocationMeta, setSetLocationMeta] = useState<boolean>(
    initial?.set_location_meta ?? true,
  )

  const [cloning, setCloning] = useState(false)
  const [rewriting, setRewriting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [contentExpanded, setContentExpanded] = useState(false)

  const contentWords = content
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length

  useEffect(() => {
    setSitesLoading(true)
    fetch('/api/sites')
      .then((r) => r.json())
      .then((d) => {
        const wpSites: Site[] = (d.sites || []).filter((s: Site) => s.site_type === 'wordpress')
        setSites(wpSites)
        if (!siteId && wpSites.length === 1) setSiteId(wpSites[0].id)
      })
      .catch(() => toast.error('Failed to load sites'))
      .finally(() => setSitesLoading(false))
    // Only run on mount — the site picker owns its own state after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!siteId) {
      setWpPages([])
      return
    }
    let cancelled = false
    setWpPagesLoading(true)
    setWpPagesError(null)
    fetch(`/api/seo-pages/wp-pages?site_id=${siteId}&kind=${sourceKind}`)
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d.error || `Failed to load WordPress ${sourceKind}s`)
        return d.pages as WPPageOption[]
      })
      .then((pages) => {
        if (cancelled) return
        setWpPages(pages || [])
      })
      .catch((err) => {
        if (cancelled) return
        setWpPagesError(err instanceof Error ? err.message : `Failed to load WordPress ${sourceKind}s`)
      })
      .finally(() => {
        if (!cancelled) setWpPagesLoading(false)
      })
    return () => { cancelled = true }
  }, [siteId, sourceKind])

  const canClone = Boolean(siteId && sourcePageId && sourceCity.trim() && targetCity.trim())
  // A similarity button is what SETS `similarity`, so the guard here is just
  // that we have a model and something to rewrite.
  const canRewrite = Boolean(model && content.trim())

  async function doClone() {
    if (!canClone) return
    setCloning(true)
    try {
      const res = await fetch('/api/seo-pages/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site_id: siteId,
          source_kind: sourceKind,
          source_page_id: sourcePageId,
          source_city: sourceCity,
          target_city: targetCity,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Clone failed')
      setTitle(data.clone.title)
      setSlug(data.clone.slug)
      setContent(data.clone.content)
      setExcerpt(data.clone.excerpt)
      setYoastTitle(data.clone.yoast_title || '')
      setYoastMetaDescription(data.clone.yoast_meta_description || '')
      setFocusKeyphrase(data.clone.focus_keyphrase || '')
      setKeyphraseSynonyms(data.clone.keyphrase_synonyms || '')
      setSourceTemplate(data.source?.template || '')
      setSourceYoast({
        title: data.source?.yoast_title || '',
        metaDescription: data.source?.yoast_meta_description || '',
        focusKeyphrase: data.source?.focus_keyphrase || '',
        keyphraseSynonyms: data.source?.keyphrase_synonyms || '',
      })
      toast.success('Cloned — every mention of the source city was swapped')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Clone failed')
    } finally {
      setCloning(false)
    }
  }

  async function doRewrite(pct: SEOPageSimilarity) {
    if (!model) { toast.error('Pick an AI model first'); return }
    if (!content.trim()) { toast.error('Nothing to rewrite yet — clone a page first'); return }
    setSimilarity(pct)
    setRewriting(true)
    try {
      const res = await fetch('/api/seo-pages/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          model,
          similarity: pct,
          instructions: instructionSet?.instructions || '',
          target_city: targetCity,
          seo_page_id: savedId || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Rewrite failed')
      setContent(data.content)
      if (data.usage?.cost_usd) {
        setCostTotal((t) => t + Number(data.usage.cost_usd))
      }
      const drift = Math.abs(data.newWordCount - data.originalWordCount)
      const tolerated = Math.max(30, Math.round(data.originalWordCount * 0.1))
      if (drift > tolerated) {
        toast(`Rewrite done — word count moved from ${data.originalWordCount} to ${data.newWordCount}`, { icon: '⚠️' })
      } else {
        toast.success(`Rewrite done (${data.newWordCount} words, ${pct}% similar)`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rewrite failed')
    } finally {
      setRewriting(false)
    }
  }

  /** Re-run the city swap on the current fields, without touching the AI.
   *  Useful when the user has manually edited content and wants the city
   *  swap re-applied, or when all they wanted was the city change to begin
   *  with. Uses the same tag-aware swap the clone endpoint uses. */
  function swapCityOnly() {
    if (!sourceCity.trim() || !targetCity.trim()) {
      toast.error('Set the source and target city first')
      return
    }
    const src = parseCity(sourceCity)
    const tgt = parseCity(targetCity, src.state)
    setTitle((v) => replaceCityInText(v, src, tgt))
    setSlug((v) => replaceCityInSlug(v, src, tgt))
    setContent((v) => replaceCityInHtml(v, src, tgt))
    setExcerpt((v) => replaceCityInText(v, src, tgt))
    setYoastTitle((v) => replaceCityInText(v, src, tgt))
    setYoastMetaDescription((v) => replaceCityInText(v, src, tgt))
    setFocusKeyphrase((v) => replaceCityInText(v, src, tgt))
    setKeyphraseSynonyms((v) => replaceCityInText(v, src, tgt))
    toast.success(`Swapped “${src.display}” → “${tgt.display}” in every field`)
  }

  /** Ad-hoc find/replace across every field. Case-insensitive. Content is
   *  processed with the tag-safe helper so HTML attributes stay intact.
   *  Meant for cases the city swap can't catch — e.g. a source page with a
   *  typo ("Los Angles"), or any custom string the user wants to fix. */
  function findAndReplace() {
    const from = findText.trim()
    if (!from) { toast.error('Enter what to find first'); return }
    let hits = 0
    const countHits = (before: string, after: string) => { if (before !== after) hits += 1 }
    setTitle((v) => { const n = findReplaceInText(v, from, replaceText); countHits(v, n); return n })
    setSlug((v) => { const n = findReplaceInText(v, from, replaceText); countHits(v, n); return n })
    setContent((v) => { const n = findReplaceInHtml(v, from, replaceText); countHits(v, n); return n })
    setExcerpt((v) => { const n = findReplaceInText(v, from, replaceText); countHits(v, n); return n })
    setYoastTitle((v) => { const n = findReplaceInText(v, from, replaceText); countHits(v, n); return n })
    setYoastMetaDescription((v) => { const n = findReplaceInText(v, from, replaceText); countHits(v, n); return n })
    setFocusKeyphrase((v) => { const n = findReplaceInText(v, from, replaceText); countHits(v, n); return n })
    setKeyphraseSynonyms((v) => { const n = findReplaceInText(v, from, replaceText); countHits(v, n); return n })
    if (hits === 0) toast(`No occurrences of “${from}” found`, { icon: 'ℹ️' })
    else toast.success(`Replaced “${from}” → “${replaceText}” in ${hits} field${hits === 1 ? '' : 's'}`)
  }

  function buildPayload(status: SEOPage['status'] = 'draft') {
    return {
      site_id: siteId,
      source_kind: sourceKind,
      source_page_id: sourcePageId,
      source_slug: wpPages.find((p) => p.id === sourcePageId)?.slug,
      source_title: wpPages.find((p) => p.id === sourcePageId)?.title,
      source_city: sourceCity,
      target_city: targetCity,
      title,
      slug,
      content,
      excerpt,
      featured_image_url: featuredImageUrl,
      featured_image_prompt: featuredImagePrompt,
      featured_image_alt: featuredImageAlt,
      yoast_title: yoastTitle || null,
      yoast_meta_description: yoastMetaDescription || null,
      focus_keyphrase: focusKeyphrase || null,
      keyphrase_synonyms: keyphraseSynonyms || null,
      ai_model: model || null,
      instruction_id: instructionId,
      rewrite_similarity: similarity,
      set_location_meta: setLocationMeta,
      source_template: sourceTemplate || null,
      status,
      scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
    }
  }

  async function saveDraft(silent = false) {
    if (!siteId) { toast.error('Pick a WordPress site'); return null }
    if (!title.trim()) { toast.error('Title is required'); return null }
    setSaving(true)
    try {
      const method = savedId ? 'PATCH' : 'POST'
      const url = savedId ? `/api/seo-pages/${savedId}` : '/api/seo-pages'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload('draft')),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      const seoPage = data.seoPage as SEOPage
      setSavedId(seoPage.id)
      // Only nudge the URL when this was a first-time create; PATCH stays put
      // so the user's active field isn't blurred by a route change.
      if (!silent && !initial && method === 'POST') {
        router.replace(`/seo-pages/${seoPage.id}`)
      }
      if (!silent) toast.success('Draft saved')
      return seoPage
    } catch (err) {
      // Errors always surface, even in "silent" mode. Silent was meant to
      // suppress redundant success toasts on publish/schedule flows, not to
      // hide failures — swallowing errors made a failed save look like a
      // dead Publish button.
      toast.error(err instanceof Error ? err.message : 'Save failed', { duration: 8000 })
      return null
    } finally {
      setSaving(false)
    }
  }

  /** Entry point for the "Publish now" button. When this page has already
   *  been published (wpPageUrl is set), pause for a confirmation so a
   *  re-run doesn't silently overwrite live content — unless the user has
   *  opted out of the prompt via localStorage. */
  async function publishNow() {
    const skip = typeof window !== 'undefined'
      && window.localStorage.getItem(SKIP_REPUBLISH_CONFIRM_KEY) === '1'
    if (wpPageUrl && !skip) {
      setShowRepublishConfirm(true)
      return
    }
    await doPublish()
  }

  /** The real publish call — kept separate so both the direct path and the
   *  "Yes, override" modal buttons can reuse it. */
  async function doPublish() {
    const saved = await saveDraft(true)
    if (!saved) return
    setPublishing(true)
    try {
      const res = await fetch('/api/seo-pages/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seoPageId: saved.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Publish failed')
      if (data.url) setWpPageUrl(data.url)
      if (data.imageWarning) {
        toast.error(`Published, but featured image: ${data.imageWarning}`, { duration: 6000 })
      } else {
        toast.success('Published to WordPress')
      }
      if (data.yoastWarning) {
        toast.error(`Yoast SEO: ${data.yoastWarning}`, { duration: 12000 })
      }
      if (data.metaWarning) {
        toast.error(`Custom meta: ${data.metaWarning}`, { duration: 12000 })
      }
      // Sync the URL so a refresh lands on the edit route, but don't `push` —
      // `router.replace` keeps the freshly-set banner state in view instead of
      // resetting the component on navigation.
      if (!initial) router.replace(`/seo-pages/${saved.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publish failed')
    } finally {
      setPublishing(false)
    }
  }

  async function scheduleForPublish() {
    if (!scheduledAt) { toast.error('Pick a date and time first'); return }
    const saved = await saveDraft(true)
    if (!saved) return
    setPublishing(true)
    try {
      const iso = new Date(scheduledAt).toISOString()
      const res = await fetch('/api/seo-pages/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seoPageId: saved.id, scheduledAt: iso }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Schedule failed')
      if (data.url) setWpPageUrl(data.url)
      toast.success(`Scheduled for ${new Date(iso).toLocaleString()}`)
      if (!initial) router.replace(`/seo-pages/${saved.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Schedule failed')
    } finally {
      setPublishing(false)
    }
  }

  const wpPageLookup = useMemo(() => new Map(wpPages.map((p) => [p.id, p])), [wpPages])
  const selectedWpPage = sourcePageId ? wpPageLookup.get(sourcePageId) : null

  return (
    <div>
      <Header
        title={savedId ? 'Edit SEO page' : 'New SEO page'}
        subtitle={savedId ? 'Update, rewrite, or republish the draft' : 'Clone a WordPress post or page for another city'}
        actions={
          <div className="flex items-center gap-2">
            <div
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-300"
              title="Sum of every AI usage row (rewrite + image generation) tied to this SEO page"
            >
              <span className="text-gray-400">Total cost</span>
              <span className="text-gray-900 dark:text-white font-mono">
                {costTotal > 0 ? `$${costTotal.toFixed(4)}` : '$0.0000'}
              </span>
            </div>
            <Link
              href="/seo-pages"
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </Link>
            <button
              onClick={() => saveDraft()}
              disabled={saving || publishing}
              className="flex items-center gap-1.5 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save draft
            </button>
            <button
              onClick={publishNow}
              disabled={saving || publishing || !title || !content}
              className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
            >
              {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
              Publish now
            </button>
          </div>
        }
      />

      {wpPageUrl && (
        <div className="mb-6 rounded-2xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-900/20 p-4 flex items-start gap-3">
          <Rocket className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
              Live on WordPress
            </p>
            <a
              href={wpPageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300 hover:underline break-all"
            >
              <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
              {wpPageUrl}
            </a>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
              <MapPin className="w-4 h-4 text-brand-500" />
              1 · Clone a source {sourceKind}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Source type</label>
              <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-700 p-1">
                {(['post', 'page'] as const).map((kind) => {
                  const active = sourceKind === kind
                  return (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => {
                        if (savedId || kind === sourceKind) return
                        setSourceKind(kind)
                        setSourcePageId(null)
                      }}
                      disabled={Boolean(savedId)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors disabled:opacity-60 ${
                        active
                          ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                      }`}
                    >
                      {kind}s
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                Reads from WordPress {sourceKind === 'page' ? '/wp/v2/pages' : '/wp/v2/posts'} and publishes back to the same collection.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">WordPress site</label>
              <select
                value={siteId}
                onChange={(e) => {
                  setSiteId(e.target.value)
                  setSourcePageId(null)
                }}
                disabled={sitesLoading || Boolean(savedId)}
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
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Source {sourceKind}
                {wpPagesLoading && <Loader2 className="inline-block w-3 h-3 animate-spin ml-2" />}
              </label>
              <select
                value={sourcePageId ?? ''}
                onChange={(e) => setSourcePageId(e.target.value ? Number(e.target.value) : null)}
                disabled={!siteId || wpPagesLoading}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
              >
                <option value="">
                  {!siteId
                    ? 'Pick a site first'
                    : wpPagesLoading
                      ? `Loading ${sourceKind}s…`
                      : wpPages.length === 0
                        ? `No ${sourceKind}s found`
                        : `Pick a ${sourceKind} to clone`}
                </option>
                {wpPages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}  ·  /{p.slug}
                  </option>
                ))}
              </select>
              {wpPagesError && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1.5">{wpPagesError}</p>
              )}
              {selectedWpPage && (
                <a
                  href={selectedWpPage.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400 hover:underline mt-1.5"
                >
                  <ExternalLink className="w-3 h-3" />
                  View source {sourceKind}
                </a>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Source city</label>
                <input
                  type="text"
                  value={sourceCity}
                  onChange={(e) => setSourceCity(e.target.value)}
                  placeholder="Los Angeles CA"
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <p className="text-[11px] text-gray-400 mt-1">City on the source page — state code optional.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Target city</label>
                <input
                  type="text"
                  value={targetCity}
                  onChange={(e) => setTargetCity(e.target.value)}
                  placeholder="San Diego CA"
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <p className="text-[11px] text-gray-400 mt-1">Slug keeps the state; body drops it.</p>
              </div>
            </div>

            <button
              onClick={doClone}
              disabled={!canClone || cloning}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
            >
              {cloning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
              Clone into draft
            </button>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
              <Sparkles className="w-4 h-4 text-brand-500" />
              2 · Preview & edit the page
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Post title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Web Design in San Diego"
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Slug</label>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="web-design-in-san-diego-ca"
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Content</label>
              <ArticleEditor
                value={content}
                onChange={setContent}
                bodyHeightClass={
                  contentExpanded || !contentWords
                    ? 'min-h-[400px]'
                    : 'h-[340px] overflow-y-auto'
                }
              />

              {contentWords > 0 && (
                <button
                  type="button"
                  onClick={() => setContentExpanded((v) => !v)}
                  className="w-full mt-2 flex items-center justify-center gap-2 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  {contentExpanded ? (
                    <><ChevronUp className="w-4 h-4" />Collapse post</>
                  ) : (
                    <>
                      <ChevronDown className="w-4 h-4" />
                      Expand post
                      <span className="text-gray-400 dark:text-gray-500 font-normal">
                        {contentWords.toLocaleString()} words
                      </span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
              <Wand2 className="w-4 h-4 text-brand-500" />
              3 · AI rewrite (keeps headings & word count)
            </div>

            <InstructionSets
              selectedId={instructionId}
              onSelect={(set) => {
                setInstructionSet(set)
                setInstructionId(set.id)
              }}
              autoSelectDefault
            />

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Model</label>
              <ModelSelect value={model} onChange={setModel} variant="compact" />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Similarity to source</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {SIMILARITY_BUTTONS.map((b) => {
                  const active = similarity === b.value
                  return (
                    <button
                      key={b.value}
                      type="button"
                      onClick={() => setSimilarity(b.value)}
                      disabled={rewriting}
                      title={b.hint}
                      className={`flex flex-col items-center justify-center gap-1 py-3 rounded-lg border text-xs font-medium transition-colors disabled:opacity-50 ${
                        active
                          ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-400'
                          : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-brand-300 dark:hover:border-brand-700'
                      }`}
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      {b.label}
                    </button>
                  )
                })}
              </div>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={swapCityOnly}
                  disabled={rewriting || !sourceCity.trim() || !targetCity.trim()}
                  title="Just replace the city name across every field. No AI call, no cost."
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                >
                  <MapPin className="w-4 h-4" />
                  Only city name
                </button>
                <button
                  type="button"
                  onClick={() => similarity && doRewrite(similarity)}
                  disabled={rewriting || !canRewrite || similarity === null}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
                >
                  {rewriting
                    ? <><Loader2 className="w-4 h-4 animate-spin" />Rewriting…</>
                    : <><Wand2 className="w-4 h-4" />Rewrite{similarity ? ` at ${similarity}% similar` : ''}</>}
                </button>
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">
                &quot;Only city name&quot; is a plain find-and-replace — no AI, no cost, tag internals stay untouched.
                &quot;Rewrite&quot; sends the body to the model at the picked similarity; headings stay word-for-word and word count is preserved within ±10%.
              </p>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
              <Tag className="w-4 h-4 text-brand-500" />
              4 · Yoast SEO fields
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 -mt-1">
              Copied from the source with only the city name swapped. The AI
              rewrite step never touches these — what you see is what publishes.
            </p>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">SEO title</label>
              <input
                type="text"
                value={yoastTitle}
                onChange={(e) => setYoastTitle(e.target.value)}
                placeholder="Web Design in San Diego, CA | The X Digital"
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              {sourceYoast?.title && sourceYoast.title !== yoastTitle && (
                <p className="text-[11px] text-gray-400 mt-1">
                  Source: <span className="text-gray-500 dark:text-gray-400">{sourceYoast.title}</span>
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Meta description</label>
              <textarea
                value={yoastMetaDescription}
                onChange={(e) => setYoastMetaDescription(e.target.value)}
                placeholder="One sentence describing the page for search results."
                rows={3}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
              />
              {sourceYoast?.metaDescription && sourceYoast.metaDescription !== yoastMetaDescription && (
                <p className="text-[11px] text-gray-400 mt-1">
                  Source: <span className="text-gray-500 dark:text-gray-400">{sourceYoast.metaDescription}</span>
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Focus keyphrase</label>
                <input
                  type="text"
                  value={focusKeyphrase}
                  onChange={(e) => setFocusKeyphrase(e.target.value)}
                  placeholder="web design san diego"
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                {sourceYoast?.focusKeyphrase && sourceYoast.focusKeyphrase !== focusKeyphrase && (
                  <p className="text-[11px] text-gray-400 mt-1">
                    Source: <span className="text-gray-500 dark:text-gray-400">{sourceYoast.focusKeyphrase}</span>
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Keyphrase synonyms</label>
                <input
                  type="text"
                  value={keyphraseSynonyms}
                  onChange={(e) => setKeyphraseSynonyms(e.target.value)}
                  placeholder="san diego web designer, san diego website design"
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                {sourceYoast?.keyphraseSynonyms && sourceYoast.keyphraseSynonyms !== keyphraseSynonyms && (
                  <p className="text-[11px] text-gray-400 mt-1">
                    Source: <span className="text-gray-500 dark:text-gray-400">{sourceYoast.keyphraseSynonyms}</span>
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
              <RefreshCw className="w-4 h-4 text-brand-500" />
              5 · Find and replace
            </div>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 -mt-1">
              For anything the city swap missed — typos on the source page
              (e.g. &ldquo;Los Angles&rdquo;), a stray brand name, or a phrase
              inside a shortcode. Runs across every field, tag internals stay
              untouched, case-insensitive.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Find</label>
                <input
                  type="text"
                  value={findText}
                  onChange={(e) => setFindText(e.target.value)}
                  placeholder="Los Angles"
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Replace with</label>
                <input
                  type="text"
                  value={replaceText}
                  onChange={(e) => setReplaceText(e.target.value)}
                  placeholder="Burbank"
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={findAndReplace}
              disabled={!findText.trim()}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              <RefreshCw className="w-4 h-4" />
              Replace in all fields
            </button>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Receipt className="w-4 h-4 text-gray-400" />
                Total cost
              </h3>
              <span className="text-lg font-mono font-semibold text-gray-900 dark:text-white">
                ${costTotal.toFixed(4)}
              </span>
            </div>
            <p className="text-[11px] text-gray-400">
              Sum of every AI usage row tied to this SEO page — rewrites plus
              image generations. Cloning and the &ldquo;Only city name&rdquo;
              button don&apos;t cost anything.
            </p>
          </div>

          {/* Featured image is optional on SEO pages — muted until touched so
              the card doesn't read as a required step. Focus/hover restores
              full opacity, and any generated image obviously restores it. */}
          <div
            className={`transition-opacity ${
              featuredImageUrl
                ? ''
                : 'opacity-60 hover:opacity-100 focus-within:opacity-100'
            }`}
          >
            <ImageGenerator
              heading="Featured image (optional)"
              seoPageId={savedId || undefined}
              articleTitle={title}
              siteId={siteId || undefined}
              initialImageUrl={featuredImageUrl}
              initialPrompt={featuredImagePrompt}
              initialAlt={featuredImageAlt}
              onImageGenerated={(url, prompt, alt, _ids, records) => {
                setFeaturedImageUrl(url)
                setFeaturedImagePrompt(prompt)
                setFeaturedImageAlt(alt)
                const delta = (records || [])
                  .reduce((n, r) => n + Number(r.cost_usd ?? 0), 0)
                if (delta > 0) setCostTotal((t) => t + delta)
              }}
            />
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              WordPress meta
            </h3>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={setLocationMeta}
                onChange={(e) => setSetLocationMeta(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-200">
                Tick the &ldquo;Location&rdquo; checkbox on the WP page
                <span className="block text-[11px] text-gray-400 mt-0.5">
                  Writes <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-[10px]">_location = 1</code> on publish — the meta the theme reads for the location toggle. Unchecked writes an empty value instead.
                </span>
              </span>
            </label>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <CalendarIcon className="w-4 h-4 text-gray-400" />
              Schedule
            </h3>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button
              type="button"
              onClick={scheduleForPublish}
              disabled={!scheduledAt || saving || publishing || !title || !content}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-400 text-sm font-medium hover:bg-brand-50 dark:hover:bg-brand-900/20 transition-colors disabled:opacity-50"
            >
              {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarIcon className="w-4 h-4" />}
              Schedule publish
            </button>
            <p className="text-[11px] text-gray-400">
              Uses your browser&apos;s local time. WordPress will publish the post at that moment.
            </p>
          </div>

          {wpPageUrl && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                Live {sourceKind}
              </h3>
              <a
                href={wpPageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-brand-600 dark:text-brand-400 hover:underline break-all"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                {wpPageUrl}
              </a>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={showRepublishConfirm}
        onClose={() => setShowRepublishConfirm(false)}
        title="Override the existing page?"
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            This SEO page has already been published. Continuing will overwrite
            the live content at:
          </p>
          {wpPageUrl && (
            <a
              href={wpPageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-brand-600 dark:text-brand-400 hover:underline break-all"
            >
              <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
              {wpPageUrl}
            </a>
          )}
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowRepublishConfirm(false)}
              className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              No, cancel
            </button>
            <button
              type="button"
              onClick={() => { setShowRepublishConfirm(false); void doPublish() }}
              className="flex-1 px-4 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
            >
              Yes, this time
            </button>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.localStorage.setItem(SKIP_REPUBLISH_CONFIRM_KEY, '1')
                }
                setShowRepublishConfirm(false)
                void doPublish()
              }}
              className="flex-1 px-4 py-2.5 rounded-lg border border-brand-300 dark:border-brand-700 bg-brand-50 dark:bg-brand-900/20 text-sm font-medium text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-900/30 transition-colors"
            >
              Yes, don&apos;t ask again
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

/** ISO → the value shape <input type="datetime-local"> wants (no timezone). */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
