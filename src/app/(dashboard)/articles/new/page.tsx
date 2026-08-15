'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Sparkles, Save, Send, Calendar, Loader2, Tag, X, Globe, Search, FolderOpen
} from 'lucide-react'
import ArticleEditor from '@/components/articles/ArticleEditor'
import ModelSelect, { LAST_MODEL_KEY } from '@/components/ui/ModelSelect'

const SEO_LAST_MODEL_KEY = 'zaoflo_last_model_seo'
import ImageGenerator from '@/components/articles/ImageGenerator'
import { AVAILABLE_MODELS } from '@/lib/openrouter'
import type { Site } from '@/types'
import toast from 'react-hot-toast'

interface WPCategory { id: number; name: string; count: number }

const INSTRUCTION_PRESETS = [
  { label: '800 words', value: 'Write approximately 800 words. Keep it concise and focused.' },
  { label: '1200 words', value: 'Write approximately 1200 words. Include clear sections with headings.' },
  { label: '1500 words', value: 'Write approximately 1500 words. Cover the topic in depth with examples.' },
  { label: '2000 words', value: 'Write approximately 2000 words. Comprehensive, in-depth article with multiple sections, examples, and a conclusion.' },
]

type PublishMode = 'draft' | 'now' | 'scheduled'

export default function NewArticlePage() {
  const router = useRouter()
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [keywords, setKeywords] = useState<string[]>([])
  const [keywordInput, setKeywordInput] = useState('')
  const [model, setModel] = useState('')
  const [seoModel, setSeoModel] = useState('')

  // Only restore custom (non-preset) models from localStorage — presets always default to custom mode
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LAST_MODEL_KEY)
      if (saved && !AVAILABLE_MODELS.some((m) => m.id === saved)) {
        setModel(saved)
      } else if (saved && AVAILABLE_MODELS.some((m) => m.id === saved)) {
        localStorage.removeItem(LAST_MODEL_KEY)
      }
    } catch {}
    try {
      const savedSeo = localStorage.getItem(SEO_LAST_MODEL_KEY)
      if (savedSeo && !AVAILABLE_MODELS.some((m) => m.id === savedSeo)) {
        setSeoModel(savedSeo)
      } else if (savedSeo && AVAILABLE_MODELS.some((m) => m.id === savedSeo)) {
        localStorage.removeItem(SEO_LAST_MODEL_KEY)
      }
    } catch {}
  }, [])
  const [instructions, setInstructions] = useState('')
  const [wpCategoryId, setWpCategoryId] = useState<number | ''>('')
  const [categories, setCategories] = useState<WPCategory[]>([])
  const [loadingCats, setLoadingCats] = useState(false)
  const [publishMode, setPublishMode] = useState<PublishMode>('draft')
  const [scheduledAt, setScheduledAt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generatingSEO, setGeneratingSEO] = useState(false)
  const [saving, setSaving] = useState(false)

  // SEO fields (auto-filled after generation, editable)
  const [focusKeyphrase, setFocusKeyphrase] = useState('')
  const [keyphraseSynonyms, setKeyphraseSynonyms] = useState('')
  const [yoastTitle, setYoastTitle] = useState('')
  const [yoastMetaDescription, setYoastMetaDescription] = useState('')
  const [slug, setSlug] = useState('')

  // Featured image
  const [featuredImageUrl, setFeaturedImageUrl] = useState('')
  const [featuredImagePrompt, setFeaturedImagePrompt] = useState('')
  const [featuredImageAlt, setFeaturedImageAlt] = useState('')

  useEffect(() => {
    fetch('/api/sites').then((r) => r.json()).then((d) => {
      setSites(d.sites || [])
      if (d.sites?.length > 0) setSiteId(d.sites[0].id)
    })
  }, [])

  useEffect(() => {
    if (!siteId) return
    setLoadingCats(true)
    setCategories([])
    fetch(`/api/sites/${siteId}/categories`)
      .then((r) => r.json())
      .then((d) => setCategories(d.categories || []))
      .catch(() => {})
      .finally(() => setLoadingCats(false))
  }, [siteId])

  function addKeyword(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && keywordInput.trim()) {
      e.preventDefault()
      if (!keywords.includes(keywordInput.trim())) {
        setKeywords([...keywords, keywordInput.trim()])
      }
      setKeywordInput('')
    }
  }

  async function handleGenerate() {
    if (!title.trim()) { toast.error('Enter a title before generating'); return }
    setGenerating(true)
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, keywords, instructions, model }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Generation failed')
      setContent(data.content)
      // Auto-fill SEO fields
      if (data.seo) {
        setFocusKeyphrase(data.seo.focusKeyphrase || '')
        setKeyphraseSynonyms(data.seo.keyphraseSynonyms || '')
        setYoastTitle(data.seo.yoastTitle || '')
        setYoastMetaDescription(data.seo.yoastMetaDescription || '')
        setSlug(data.seo.slug || '')
      }
      toast.success('Article + SEO fields generated!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  async function handleGenerateSEO() {
    if (!title.trim()) { toast.error('Enter a title before generating SEO'); return }
    setGeneratingSEO(true)
    try {
      const res = await fetch('/api/generate-seo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, keywords, model: seoModel }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'SEO generation failed')
      if (data.seo) {
        setFocusKeyphrase(data.seo.focusKeyphrase || '')
        setKeyphraseSynonyms(data.seo.keyphraseSynonyms || '')
        setYoastTitle(data.seo.yoastTitle || '')
        setYoastMetaDescription(data.seo.yoastMetaDescription || '')
        setSlug(data.seo.slug || '')
      }
      toast.success('SEO fields regenerated!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'SEO generation failed')
    } finally {
      setGeneratingSEO(false)
    }
  }

  async function handleSave() {
    if (!title.trim()) { toast.error('Title is required'); return }
    if (!siteId) { toast.error('Select a site'); return }
    if (publishMode === 'scheduled' && !scheduledAt) { toast.error('Pick a date and time to schedule'); return }

    setSaving(true)
    try {
      const payload = {
        site_id: siteId,
        title,
        content,
        keywords,
        ai_model: model,
        status: publishMode === 'draft' ? 'draft' : 'scheduled',
        scheduled_at: publishMode === 'scheduled' ? scheduledAt : null,
        focus_keyphrase: focusKeyphrase || null,
        keyphrase_synonyms: keyphraseSynonyms || null,
        yoast_title: yoastTitle || null,
        yoast_meta_description: yoastMetaDescription || null,
        slug: slug || null,
        featured_image_url: featuredImageUrl || null,
        featured_image_prompt: featuredImagePrompt || null,
        featured_image_alt: featuredImageAlt || null,
        wp_category_id: wpCategoryId || null,
      }

      const res = await fetch('/api/articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')

      if (publishMode === 'now') {
        // Publish immediately to WordPress
        const pubRes = await fetch('/api/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ articleId: data.article.id }),
        })
        const pubData = await pubRes.json()
        if (!pubRes.ok) throw new Error(pubData.error || 'Publish failed')
        if (pubData.imageWarning) {
          toast.success('Article published to WordPress!')
          toast.error(`Featured image: ${pubData.imageWarning}`, { duration: 8000 })
        } else {
          toast.success('Article published to WordPress!')
        }
      } else if (publishMode === 'scheduled') {
        // Send to WordPress as a scheduled (future) post — WP handles publishing at the right time
        const pubRes = await fetch('/api/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ articleId: data.article.id, scheduledAt }),
        })
        const pubData = await pubRes.json()
        if (!pubRes.ok) throw new Error(pubData.error || 'Scheduling failed')
        toast.success('Article scheduled on WordPress!')
      } else {
        toast.success('Article saved as draft')
      }

      router.push('/articles')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">New Article</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Write or generate SEO content for WordPress</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            Save draft
          </button>
          <button
            onClick={() => { setPublishMode('now'); handleSave() }}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            Publish now
          </button>
        </div>
      </div>

      <div className="flex gap-6 items-start">
        {/* Main editor */}
        <div className="flex-1 min-w-0 space-y-4">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Article title..."
            className="w-full text-2xl font-bold text-gray-900 dark:text-white placeholder-gray-300 dark:placeholder-gray-600 bg-transparent border-0 outline-none py-2"
          />

          {/* AI Instructions — near the title so it's clear what it applies to */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
              <span className="text-xs text-gray-400 dark:text-gray-500 mr-1">Presets:</span>
              {INSTRUCTION_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setInstructions(p.value)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
                    instructions === p.value
                      ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-400'
                      : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="AI instructions: tone, audience, word count, specific points to cover… (optional)"
              rows={2}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y"
            />
          </div>

          {/* AI Generate bar */}
          <div className="p-3 bg-brand-50 dark:bg-brand-900/20 border border-brand-100 dark:border-brand-900/40 rounded-xl">
            <div className="flex items-center gap-3">
              <Sparkles className="w-4 h-4 text-brand-600 flex-shrink-0" />
              <div className="flex-1">
                <ModelSelect
                  value={model}
                  onChange={setModel}
                />
              </div>
              <button
                onClick={handleGenerate}
                disabled={generating || !title.trim()}
                className="flex items-center gap-2 bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-50 flex-shrink-0"
              >
                {generating
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Generating…</>
                  : <><Sparkles className="w-3.5 h-3.5" />Generate with AI</>}
              </button>
            </div>
          </div>

          <ArticleEditor
            value={content}
            onChange={setContent}
            placeholder="Start writing, or click Generate with AI above..."
          />

          {/* SEO Fields — shown after generation or always editable */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Search className="w-4 h-4 text-gray-400" />
              SEO / Yoast Fields
            </h3>
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <ModelSelect
                  value={seoModel}
                  onChange={setSeoModel}
                  lastModelKey={SEO_LAST_MODEL_KEY}
                />
              </div>
              <button
                onClick={handleGenerateSEO}
                disabled={generatingSEO || !title.trim()}
                className="flex items-center gap-1.5 px-3 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-50 shrink-0"
              >
                {generatingSEO
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Generating…</>
                  : <><Sparkles className="w-3.5 h-3.5" />Generate SEO</>}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Focus Keyphrase</label>
                <input
                  type="text"
                  value={focusKeyphrase}
                  onChange={(e) => setFocusKeyphrase(e.target.value)}
                  placeholder="main keyword"
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Keyphrase Synonym</label>
                <input
                  type="text"
                  value={keyphraseSynonyms}
                  onChange={(e) => setKeyphraseSynonyms(e.target.value)}
                  placeholder="synonym word"
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1 flex justify-between">
                <span>SEO Title</span>
                <span className={`font-mono ${yoastTitle.length > 70 ? 'text-red-500' : yoastTitle.length >= 50 ? 'text-green-600' : 'text-gray-400'}`}>
                  {yoastTitle.length} chars
                </span>
              </label>
              <input
                type="text"
                value={yoastTitle}
                onChange={(e) => setYoastTitle(e.target.value)}
                placeholder="SEO title"
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1 flex justify-between">
                <span>Meta Description</span>
                <span className={`font-mono ${yoastMetaDescription.length > 160 ? 'text-red-500' : yoastMetaDescription.length >= 155 ? 'text-green-600' : 'text-gray-400'}`}>
                  {yoastMetaDescription.length}/160
                </span>
              </label>
              <textarea
                value={yoastMetaDescription}
                onChange={(e) => setYoastMetaDescription(e.target.value)}
                placeholder="Meta description (155–160 chars)"
                rows={2}
                maxLength={165}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1 flex justify-between">
                <span>URL Slug</span>
                <span className={`font-mono ${slug.length > 60 ? 'text-red-500' : 'text-gray-400'}`}>
                  {slug.length}/60
                </span>
              </label>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-'))}
                placeholder="article-url-slug"
                maxLength={60}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-mono text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-80 shrink-0 space-y-4">
          {/* Site selector */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <Globe className="w-4 h-4 text-gray-400" /> Target Site
            </h3>
            {sites.length === 0 ? (
              <p className="text-xs text-gray-500">
                No sites connected.{' '}
                <a href="/sites" className="text-brand-600 hover:underline">Add a site first</a>
              </p>
            ) : (
              <select
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            {siteId && (
              <div className="mt-3">
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5 flex items-center gap-1">
                  <FolderOpen className="w-3.5 h-3.5 text-gray-400" /> Category
                </label>
                {loadingCats ? (
                  <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs text-gray-400">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />Loading…
                  </div>
                ) : (
                  <select
                    value={wpCategoryId}
                    onChange={(e) => setWpCategoryId(e.target.value ? Number(e.target.value) : '')}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="">Uncategorized</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>

          {/* Publish mode */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-gray-400" /> Publish
            </h3>
            <div className="space-y-2">
              {(['draft', 'now', 'scheduled'] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    value={mode}
                    checked={publishMode === mode}
                    onChange={() => setPublishMode(mode)}
                    className="text-brand-600 focus:ring-brand-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {mode === 'now' ? 'Publish immediately' : mode === 'scheduled' ? 'Schedule for later' : 'Save as draft'}
                  </span>
                </label>
              ))}
            </div>

            {publishMode === 'scheduled' && (
              <div className="mt-3">
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
            )}

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full mt-3 bg-brand-600 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving
                ? <><Loader2 className="w-4 h-4 animate-spin" />Processing…</>
                : <>{publishMode === 'draft' ? <Save className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                   {publishMode === 'draft' ? 'Save draft' : publishMode === 'now' ? 'Publish now' : 'Schedule'}</>}
            </button>
          </div>

          {/* Keywords */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <Tag className="w-4 h-4 text-gray-400" /> Keywords
            </h3>
            <input
              type="text"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={addKeyword}
              placeholder="Type and press Enter..."
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 mb-2"
            />
            {keywords.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {keywords.map((kw) => (
                  <span key={kw} className="flex items-center gap-1 bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400 text-xs px-2 py-1 rounded-full border border-brand-100 dark:border-brand-800">
                    {kw}
                    <button onClick={() => setKeywords(keywords.filter((k) => k !== kw))}>
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Featured Image */}
          <ImageGenerator
            articleTitle={title}
            defaultPrompt={title ? `Professional blog featured image for: ${title}` : ''}
            onImageGenerated={(url, prompt, altText) => {
              setFeaturedImageUrl(url)
              setFeaturedImagePrompt(prompt)
              setFeaturedImageAlt(altText)
            }}
          />
        </div>
      </div>
    </div>
  )
}
