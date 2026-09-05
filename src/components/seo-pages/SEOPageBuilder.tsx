'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Copy, Loader2, MapPin, Rocket, Save, Sparkles, Wand2, Calendar as CalendarIcon,
  ExternalLink, RefreshCw, ChevronDown, ChevronUp,
} from 'lucide-react'
import toast from 'react-hot-toast'

import Header from '@/components/layout/Header'
import ArticleEditor from '@/components/articles/ArticleEditor'
import ImageGenerator from '@/components/articles/ImageGenerator'
import InstructionSets from '@/components/articles/InstructionSets'
import ModelSelect from '@/components/ui/ModelSelect'
import type { ArticleInstruction, SEOPage, Site, SEOPageSimilarity, WPPageOption } from '@/types'

interface Props {
  /** Existing SEO page (edit mode) or null (new mode). */
  initial: SEOPage | null
}

const SIMILARITY_BUTTONS: { value: SEOPageSimilarity; label: string; hint: string }[] = [
  { value: 10, label: '10% similar', hint: 'Heavy rewrite — almost all words swapped' },
  { value: 25, label: '25% similar', hint: 'Substantial rewrite' },
  { value: 50, label: '50% similar', hint: 'About half the wording replaced' },
  { value: 90, label: '90% similar', hint: 'Light freshening — small tweaks only' },
]

export default function SEOPageBuilder({ initial }: Props) {
  const router = useRouter()

  const [savedId, setSavedId] = useState<string | null>(initial?.id ?? null)
  const [sites, setSites] = useState<Site[]>([])
  const [sitesLoading, setSitesLoading] = useState(true)
  const [siteId, setSiteId] = useState<string>(initial?.site_id || '')

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

  const [instructionSet, setInstructionSet] = useState<ArticleInstruction | null>(null)
  const [instructionId, setInstructionId] = useState<string | null>(initial?.instruction_id || null)
  const [model, setModel] = useState(initial?.ai_model || '')
  const [similarity, setSimilarity] = useState<SEOPageSimilarity | null>(initial?.rewrite_similarity ?? null)

  const [scheduledAt, setScheduledAt] = useState<string>(
    initial?.scheduled_at ? toLocalInputValue(initial.scheduled_at) : '',
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
    fetch(`/api/seo-pages/wp-pages?site_id=${siteId}`)
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d.error || 'Failed to load WordPress pages')
        return d.pages as WPPageOption[]
      })
      .then((pages) => {
        if (cancelled) return
        setWpPages(pages || [])
      })
      .catch((err) => {
        if (cancelled) return
        setWpPagesError(err instanceof Error ? err.message : 'Failed to load WordPress pages')
      })
      .finally(() => {
        if (!cancelled) setWpPagesLoading(false)
      })
    return () => { cancelled = true }
  }, [siteId])

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
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Rewrite failed')
      setContent(data.content)
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

  function buildPayload(status: SEOPage['status'] = 'draft') {
    return {
      site_id: siteId,
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
      ai_model: model || null,
      instruction_id: instructionId,
      rewrite_similarity: similarity,
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
      if (!silent) toast.error(err instanceof Error ? err.message : 'Save failed')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function publishNow() {
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
      if (data.imageWarning) {
        toast.error(`Published, but featured image: ${data.imageWarning}`, { duration: 6000 })
      } else {
        toast.success('Published to WordPress')
      }
      router.push(`/seo-pages/${saved.id}`)
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
      toast.success(`Scheduled for ${new Date(iso).toLocaleString()}`)
      router.push(`/seo-pages/${saved.id}`)
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
        subtitle={savedId ? 'Update, rewrite, or republish the draft' : 'Clone a WordPress page for another city'}
        actions={
          <div className="flex items-center gap-2">
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
              <MapPin className="w-4 h-4 text-brand-500" />
              1 · Clone a source page
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
                Source page
                {wpPagesLoading && <Loader2 className="inline-block w-3 h-3 animate-spin ml-2" />}
              </label>
              <select
                value={sourcePageId ?? ''}
                onChange={(e) => setSourcePageId(e.target.value ? Number(e.target.value) : null)}
                disabled={!siteId || wpPagesLoading}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
              >
                <option value="">
                  {!siteId ? 'Pick a site first' : wpPagesLoading ? 'Loading pages…' : wpPages.length === 0 ? 'No pages found' : 'Pick a page to clone'}
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
                  View source page
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
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Page title</label>
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
                    <><ChevronUp className="w-4 h-4" />Collapse page</>
                  ) : (
                    <>
                      <ChevronDown className="w-4 h-4" />
                      Expand page
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
                      onClick={() => doRewrite(b.value)}
                      disabled={rewriting || !canRewrite}
                      title={b.hint}
                      className={`flex flex-col items-center justify-center gap-1 py-3 rounded-lg border text-xs font-medium transition-colors disabled:opacity-50 ${
                        active
                          ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-400'
                          : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-brand-300 dark:hover:border-brand-700'
                      }`}
                    >
                      {rewriting && active
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <RefreshCw className="w-3.5 h-3.5" />}
                      {b.label}
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">
                10% similar = heavy rewrite (almost all words changed). 90% similar = light freshening.
                Headings stay word-for-word; word count is preserved within ±10%.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <ImageGenerator
            articleId={savedId || undefined}
            articleTitle={title}
            siteId={siteId || undefined}
            initialImageUrl={featuredImageUrl}
            initialPrompt={featuredImagePrompt}
            initialAlt={featuredImageAlt}
            onImageGenerated={(url, prompt, alt) => {
              setFeaturedImageUrl(url)
              setFeaturedImagePrompt(prompt)
              setFeaturedImageAlt(alt)
            }}
          />

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
              Uses your browser&apos;s local time. WordPress will publish the page at that moment.
            </p>
          </div>

          {initial?.wp_page_url && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Live page</h3>
              <a
                href={initial.wp_page_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-brand-600 dark:text-brand-400 hover:underline break-all"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                {initial.wp_page_url}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** ISO → the value shape <input type="datetime-local"> wants (no timezone). */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
