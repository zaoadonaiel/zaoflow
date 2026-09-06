'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { FileText, Plus, Search, Trash2, ExternalLink, Globe, Pencil } from 'lucide-react'
import Header from '@/components/layout/Header'
import Badge, { statusToBadgeVariant } from '@/components/ui/Badge'
import type { Article, Site } from '@/types'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

const STATUS_FILTERS = ['all', 'draft', 'generating', 'scheduled', 'published', 'failed'] as const
type StatusFilter = typeof STATUS_FILTERS[number]

export default function ArticlesPage() {
  const [articles, setArticles] = useState<Article[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sites, setSites] = useState<Site[]>([])
  const [siteFilter, setSiteFilter] = useState('all')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchArticles = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (siteFilter !== 'all') params.set('site_id', siteFilter)
      const res = await fetch(`/api/articles?${params}`)
      const data = await res.json()
      setArticles(data.articles || [])
      setCounts(data.counts || {})
    } finally {
      setLoading(false)
    }
  }, [search, statusFilter, siteFilter])

  useEffect(() => { fetchArticles() }, [fetchArticles])

  useEffect(() => {
    fetch('/api/sites')
      .then((r) => r.json())
      .then((d) => setSites(d.sites || []))
      .catch(() => {})
  }, [])

  async function deleteArticle(article: Article) {
    const hasWp = !!article.wp_post_id
    const msg = hasWp
      ? `Delete "${article.title}"?\n\nThis will also permanently delete it from WordPress.`
      : `Delete "${article.title}"? This cannot be undone.`
    if (!confirm(msg)) return

    setDeletingId(article.id)
    try {
      const res = await fetch(`/api/articles/${article.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Delete failed')
      setArticles((prev) => prev.filter((a) => a.id !== article.id))
      if (data.wpError) {
        toast.success('Deleted from Zao Flo', { duration: 2000 })
        toast.error(`WordPress: ${data.wpError}`, { duration: 6000 })
      } else if (data.wpDeleted) {
        toast.success('Deleted from Zao Flo and WordPress')
      } else {
        toast.success('Article deleted')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete article')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div>
      <Header
        title="Articles"
        subtitle="Manage all your blog posts"
        actions={
          <Link
            href="/articles/new"
            className="flex items-center gap-2 bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New article
          </Link>
        }
      />

      {/* Filters — stack on mobile so the search input isn't crushed next to
          the site select and the status pills don't overflow off-screen. */}
      <div className="flex flex-col gap-3 mb-6 md:flex-row md:items-center">
        <div className="relative w-full md:flex-1 md:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search articles..."
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[10rem] md:flex-none">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <select
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
              className="w-full appearance-none pl-10 pr-8 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent cursor-pointer"
            >
              <option value="all">All sites</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-1 overflow-x-auto">
            {STATUS_FILTERS.map((s) => {
              const n = s === 'all'
                ? Object.values(counts).reduce((sum, v) => sum + v, 0)
                : counts[s] ?? 0
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors whitespace-nowrap ${
                    statusFilter === s
                      ? 'bg-brand-600 text-white'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {s} <span className={`font-normal ${statusFilter === s ? 'text-white/70' : 'text-gray-400 dark:text-gray-500'}`}>({n})</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Table on desktop, stacked cards on mobile. The 12-col grid was
          cramming five columns of icons into a phone-width row and stacking
          them on top of each other; a per-row card gives the title breathing
          room and puts the actions on their own line. */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="hidden md:block px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="grid grid-cols-12 gap-4 text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
            <div className="col-span-4">Title</div>
            <div className="col-span-2">Site</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2">Date</div>
            <div className="col-span-2"></div>
          </div>
        </div>

        {loading ? (
          <div className="space-y-0">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="px-4 md:px-6 py-4 border-b border-gray-50 dark:border-gray-700 animate-pulse">
                <div className="hidden md:grid grid-cols-12 gap-4 items-center">
                  <div className="col-span-4 h-4 bg-gray-200 dark:bg-gray-700 rounded" />
                  <div className="col-span-2 h-3 bg-gray-100 dark:bg-gray-700 rounded" />
                  <div className="col-span-2 h-5 bg-gray-100 dark:bg-gray-700 rounded-full w-20" />
                  <div className="col-span-2 h-3 bg-gray-100 dark:bg-gray-700 rounded" />
                </div>
                <div className="md:hidden space-y-2">
                  <div className="h-4 w-3/4 bg-gray-200 dark:bg-gray-700 rounded" />
                  <div className="h-3 w-1/2 bg-gray-100 dark:bg-gray-700 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : articles.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="w-12 h-12 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center">
              <FileText className="w-6 h-6 text-gray-400" />
            </div>
            <div>
              <p className="font-medium text-gray-900 dark:text-white">No articles found</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {search || statusFilter !== 'all' || siteFilter !== 'all' ? 'Try adjusting your filters' : 'Create your first article to get started'}
              </p>
            </div>
            {!search && statusFilter === 'all' && siteFilter === 'all' && (
              <Link
                href="/articles/new"
                className="flex items-center gap-2 bg-brand-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                New article
              </Link>
            )}
          </div>
        ) : (
          <div>
            {articles.map((article) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const siteName = (article as any).sites?.name || '—'
              const dateLabel = format(
                new Date(
                  article.status === 'scheduled' && article.scheduled_at
                    ? article.scheduled_at
                    : article.created_at,
                ),
                'MMM d, yyyy',
              )
              const liveUrl = article.node_post_url || article.wp_post_url
              return (
                <div
                  key={article.id}
                  className="px-4 md:px-6 py-4 border-b border-gray-50 dark:border-gray-700 last:border-0 hover:bg-gray-50/50 dark:hover:bg-gray-700/30 transition-colors"
                >
                  {/* Mobile card */}
                  <div className="md:hidden flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-3">
                      <Link
                        href={`/articles/${article.id}`}
                        className="font-medium text-gray-900 dark:text-gray-100 text-sm hover:text-brand-600 dark:hover:text-brand-400 transition-colors line-clamp-2 flex-1 min-w-0"
                      >
                        {article.title}
                      </Link>
                      <Badge variant={statusToBadgeVariant(article.status)}>
                        {article.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-x-2 gap-y-1 flex-wrap text-xs text-gray-500 dark:text-gray-400">
                      <span className="inline-flex items-center gap-1 min-w-0 max-w-full truncate">
                        <Globe className="w-3 h-3 text-gray-400 shrink-0" />
                        <span className="truncate">{siteName}</span>
                      </span>
                      <span className="text-gray-300 dark:text-gray-600">·</span>
                      <span>
                        {article.status === 'scheduled' && article.scheduled_at ? 'Publishes ' : ''}
                        {dateLabel}
                      </span>
                      {article.word_count && (
                        <>
                          <span className="text-gray-300 dark:text-gray-600">·</span>
                          <span>{article.word_count.toLocaleString()} words</span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1 -ml-1.5 pt-1">
                      <Link
                        href={`/articles/${article.id}`}
                        className="inline-flex items-center gap-1.5 px-2 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        title="Edit article"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Edit
                      </Link>
                      {liveUrl && (
                        <a
                          href={liveUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-2 py-1.5 text-xs text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                          title={article.node_post_url ? 'View live' : 'View on WordPress'}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          View
                        </a>
                      )}
                      <button
                        onClick={() => deleteArticle(article)}
                        disabled={deletingId === article.id}
                        className="inline-flex items-center gap-1.5 px-2 py-1.5 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50 ml-auto"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Desktop grid */}
                  <div className="hidden md:grid grid-cols-12 gap-4 items-center">
                    <div className="col-span-4">
                      <Link
                        href={`/articles/${article.id}`}
                        className="font-medium text-gray-900 dark:text-gray-100 text-sm hover:text-brand-600 dark:hover:text-brand-400 transition-colors line-clamp-1"
                      >
                        {article.title}
                      </Link>
                      {article.word_count && (
                        <p className="text-xs text-gray-400 mt-0.5">{article.word_count.toLocaleString()} words</p>
                      )}
                    </div>
                    <div className="col-span-2">
                      <span className="text-sm text-gray-500 dark:text-gray-400 truncate block">
                        {siteName}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <Badge variant={statusToBadgeVariant(article.status)}>
                        {article.status}
                      </Badge>
                    </div>
                    <div className="col-span-2">
                      <span className="text-xs text-gray-400">{dateLabel}</span>
                      {article.status === 'scheduled' && article.scheduled_at && (
                        <p className="text-[10px] text-gray-400 mt-0.5">Publishes</p>
                      )}
                    </div>
                    <div className="col-span-2 flex items-center gap-1 justify-end">
                      <Link
                        href={`/articles/${article.id}`}
                        className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        title="Edit article"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Link>
                      {liveUrl && (
                        <a
                          href={liveUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                          title={article.node_post_url ? 'View live' : 'View on WordPress'}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                      <button
                        onClick={() => deleteArticle(article)}
                        disabled={deletingId === article.id}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
