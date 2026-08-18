'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Save, Send, Loader2, ExternalLink, ArrowLeft, Sparkles, Tag, X, Globe, FolderOpen } from 'lucide-react'
import ArticleEditor from '@/components/articles/ArticleEditor'
import Badge, { statusToBadgeVariant } from '@/components/ui/Badge'
import { AVAILABLE_MODELS } from '@/lib/openrouter'
import type { Article, Site } from '@/types'
import toast from 'react-hot-toast'
import Link from 'next/link'

interface WPCategory { id: number; name: string; count: number }

export default function ArticleDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [article, setArticle] = useState<Article | null>(null)
  const [sites, setSites] = useState<Site[]>([])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [keywords, setKeywords] = useState<string[]>([])
  const [keywordInput, setKeywordInput] = useState('')
  const [siteId, setSiteId] = useState('')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [categories, setCategories] = useState<WPCategory[]>([])
  const [loadingCats, setLoadingCats] = useState(false)
  const [model, setModel] = useState(AVAILABLE_MODELS[0].id)
  const [scheduledAt, setScheduledAt] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch(`/api/articles/${id}`).then((r) => r.json()),
      fetch('/api/sites').then((r) => r.json()),
    ]).then(([articleData, sitesData]) => {
      const a: Article = articleData.article
      setArticle(a)
      setTitle(a.title)
      setContent(a.content)
      setKeywords(a.keywords || [])
      setSiteId(a.site_id)
      setCategoryId(a.wp_category_id || '')
      setModel(a.ai_model || AVAILABLE_MODELS[0].id)
      if (a.scheduled_at) setScheduledAt(a.scheduled_at.slice(0, 16))
      setSites(sitesData.sites || [])
      setLoading(false)
    })
  }, [id])

  // Fetch categories whenever site changes
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

  async function handleSave(): Promise<boolean> {
    setSaving(true)
    try {
      const res = await fetch(`/api/articles/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, keywords, site_id: siteId, ai_model: model, wp_category_id: categoryId || null }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Save failed')
      }
      toast.success('Saved')
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function handlePublish() {
    setPublishing(true)
    try {
      // Publishing reads the category (and everything else) back off the saved row,
      // so a failed save would quietly publish the previous values.
      const saved = await handleSave()
      if (!saved) return
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId: id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Publish failed')
      setArticle((prev) => prev ? { ...prev, status: 'published', wp_post_url: data.url } : prev)
      toast.success('Published to WordPress!')
      if (data.imageWarning) {
        toast.error(`Featured image: ${data.imageWarning}`, { duration: 8000 })
      }
      if (data.categoryWarning) {
        toast.error(`Category: ${data.categoryWarning}`, { duration: 10000 })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publish failed')
    } finally {
      setPublishing(false)
    }
  }

  async function handleGenerate() {
    if (!title.trim()) { toast.error('Enter a title first'); return }
    setGenerating(true)
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, keywords, model }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setContent(data.content)
      toast.success('Generated!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  function addKeyword(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && keywordInput.trim()) {
      e.preventDefault()
      if (!keywords.includes(keywordInput.trim())) setKeywords([...keywords, keywordInput.trim()])
      setKeywordInput('')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 text-brand-600 animate-spin" />
      </div>
    )
  }

  if (!article) {
    return <div className="text-center py-20 text-gray-500">Article not found</div>
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/articles" className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
            <ArrowLeft className="w-4 h-4 text-gray-600 dark:text-gray-400" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white line-clamp-1">{title || 'Untitled'}</h1>
              <Badge variant={statusToBadgeVariant(article.status)}>{article.status}</Badge>
            </div>
            {article.wp_post_url && (
              <a href={article.wp_post_url} target="_blank" rel="noopener noreferrer"
                className="text-xs text-brand-600 hover:underline flex items-center gap-1 mt-0.5">
                View on WordPress <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 spin" /> : <Save className="w-4 h-4" />}
            Save
          </button>
          {article.status !== 'published' && (
            <button onClick={handlePublish} disabled={publishing}
              className="flex items-center gap-2 px-4 py-2.5 bg-brand-600 text-white rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {publishing ? <Loader2 className="w-4 h-4 spin" /> : <Send className="w-4 h-4" />}
              Publish
            </button>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Article title..."
            className="w-full text-2xl font-bold text-gray-900 dark:text-white placeholder-gray-300 dark:placeholder-gray-600 bg-transparent border-0 outline-none py-2" />

          <div className="flex items-center gap-3 p-3 bg-brand-50 dark:bg-brand-900/30 border border-brand-100 dark:border-brand-800 rounded-xl">
            <Sparkles className="w-4 h-4 text-brand-600 dark:text-brand-400 flex-shrink-0" />
            <select value={model} onChange={(e) => setModel(e.target.value)}
              className="flex-1 text-sm text-brand-700 dark:text-brand-300 bg-transparent border-0 outline-none font-medium">
              {AVAILABLE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <button onClick={handleGenerate} disabled={generating || !title.trim()}
              className="flex items-center gap-2 bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-50">
              {generating ? <><Loader2 className="w-3.5 h-3.5 spin" />Regenerating...</> : <><Sparkles className="w-3.5 h-3.5" />Regenerate</>}
            </button>
          </div>

          <ArticleEditor value={content} onChange={setContent} />
        </div>

        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <Globe className="w-4 h-4 text-gray-400" />Target Site
            </h3>
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500">
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-gray-400" />Category
            </h3>
            {loadingCats ? (
              <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />Loading categories...
              </div>
            ) : (
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : '')}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">— Uncategorized —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.count})</option>
                ))}
              </select>
            )}
          </div>

          {article.word_count && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-400 dark:text-gray-500 text-xs">Words</p>
                  <p className="font-semibold text-gray-900 dark:text-white">{article.word_count.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-gray-400 dark:text-gray-500 text-xs">Model</p>
                  <p className="font-semibold text-gray-900 dark:text-white text-xs truncate">
                    {AVAILABLE_MODELS.find((m) => m.id === article.ai_model)?.name || article.ai_model || '—'}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <Tag className="w-4 h-4 text-gray-400" />Keywords
            </h3>
            <input type="text" value={keywordInput} onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={addKeyword} placeholder="Add keyword (Enter)..."
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 mb-2" />
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
          </div>
        </div>
      </div>
    </div>
  )
}
