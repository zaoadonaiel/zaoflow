'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { FileText, Plus, Search, Archive, ExternalLink, Pencil, AlertTriangle, CalendarDays } from 'lucide-react'
import Header from '@/components/layout/Header'
import Badge, { statusToBadgeVariant } from '@/components/ui/Badge'
import type { Article, Site } from '@/types'
import { format } from 'date-fns'
import { formatInZone } from '@/lib/timezone'
import { money } from '@/lib/format'
import SitePills from '@/components/ui/SitePills'
import ScheduleCalendarOverview from '@/components/schedules/ScheduleCalendarOverview'
import toast from 'react-hot-toast'

/**
 * When this article happens, in the zone it was scheduled in.
 *
 * The zone is part of the reading rather than decoration: 2 PM PST and 2 PM EST
 * are four hours apart, and a list showing only "2:00 PM" cannot be acted on.
 */
function ArticleWhen({ article }: { article: Article }) {
  const zone = article.scheduled_tz || 'PST'
  const publishedAt = article.status === 'published' ? article.published_at : null
  const scheduledAt = article.status !== 'published' ? article.scheduled_at : null
  const iso = publishedAt || scheduledAt

  if (!iso) {
    return (
      <div className="text-xs text-gray-400 leading-snug">
        <span className="block">Created</span>
        <span className="block">{format(new Date(article.created_at), 'MMM d, yyyy')}</span>
      </div>
    )
  }

  return (
    <div className="text-xs leading-snug">
      <span
        className={`block font-medium ${
          publishedAt ? 'text-gray-500 dark:text-gray-400' : 'text-brand-600 dark:text-brand-400'
        }`}
      >
        {publishedAt ? 'Published' : 'Scheduled'}
      </span>
      <span className="block text-gray-500 dark:text-gray-400">{formatInZone(iso, zone)}</span>
      {!publishedAt && article.is_paused && (
        <span className="block text-amber-500 font-medium">Paused</span>
      )}
    </div>
  )
}

// 'cost' is not an article status — it switches the list into the internal
// spend breakdown rather than filtering by anything.
const STATUS_FILTERS = ['all', 'draft', 'scheduled', 'published', 'failed', 'cost'] as const
type StatusFilter = typeof STATUS_FILTERS[number]

const STEP_LABEL: Record<string, string> = {
  idea: 'Idea',
  article: 'Article Generated',
  seo: 'Yoast SEO Meta',
  image: 'Image',
}

export default function ArticlesPage() {
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sites, setSites] = useState<Site[]>([])
  const [siteFilter, setSiteFilter] = useState('all')
  const [archivingId, setArchivingId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // The month view of everything in the list, where an article is moved by
  // dragging it onto another day rather than opening it to edit a date.
  const [showCalendar, setShowCalendar] = useState(false)

  const fetchArticles = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (statusFilter !== 'all' && statusFilter !== 'cost') params.set('status', statusFilter)
      if (statusFilter === 'cost') params.set('cost', 'true')
      if (siteFilter !== 'all') params.set('site_id', siteFilter)
      const res = await fetch(`/api/articles?${params}`)
      const data = await res.json()
      // A failed query used to fall through to an empty array, which renders
      // exactly like having no articles — a broken request looked like data
      // loss. Surface it instead.
      if (!res.ok) throw new Error(data.error || 'Could not load articles')
      setArticles(data.articles || [])
      setLoadError(null)
    } catch (err) {
      setArticles([])
      setLoadError(err instanceof Error ? err.message : 'Could not load articles')
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

  /**
   * Archive, not delete — nothing here is ever thrown away.
   *
   * Goes through the schedule endpoint because that is where the WordPress
   * side of archiving already lives: a queued post is demoted to a draft so it
   * cannot go out, while a post that is already live is left alone.
   */
  async function archiveArticle(article: Article) {
    setArchivingId(article.id)
    try {
      const res = await fetch(`/api/articles/${article.id}/schedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not archive')
      setArticles((prev) => prev.filter((a) => a.id !== article.id))
      toast.success('Moved to Archive')
      if (data.wpWarning) toast.error(`WordPress: ${data.wpWarning}`, { duration: 8000 })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not archive article')
    } finally {
      setArchivingId(null)
    }
  }

  return (
    <div>
      <Header
        title="Articles"
        subtitle="Manage all your blog posts"
        actions={
          <div className="flex items-center gap-2">
            {/* The same calendar the schedules page opens, on the list it is
                about: drag a title onto another day and the move saves itself.
                It follows the site filter, so All really is every site. */}
            <button
              onClick={() => setShowCalendar(true)}
              title="Calendar"
              aria-label="Calendar"
              className="flex items-center justify-center w-11 h-11 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-brand-600 hover:border-brand-400 transition-colors"
            >
              <CalendarDays className="w-4 h-4" />
            </button>
            <Link
              href="/articles/new"
              className="flex items-center gap-2 bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New article
            </Link>
          </div>
        }
      />

      {/* Keyed on the site filter so switching sites reloads that site's
          calendar rather than showing the previous one's while it loads. */}
      {showCalendar && (
        <ScheduleCalendarOverview
          key={siteFilter}
          open
          onClose={() => setShowCalendar(false)}
          siteId={siteFilter}
          siteName={sites.find((s) => s.id === siteFilter)?.name}
          sites={sites}
          onChanged={fetchArticles}
        />
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search articles..."
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
        </div>
        <div className="flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-1">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                statusFilter === s
                  ? 'bg-brand-600 text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* One pill per site, spread across the width. Clicking one filters the
          list down to that site and lights that pill up, so which site you are
          looking at is readable without reading anything. */}
      <SitePills sites={sites} value={siteFilter} onChange={setSiteFilter} className="mb-6" />

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
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
              <div key={i} className="px-6 py-4 border-b border-gray-50 dark:border-gray-700 animate-pulse">
                <div className="grid grid-cols-12 gap-4 items-center">
                  <div className="col-span-4 h-4 bg-gray-200 dark:bg-gray-700 rounded" />
                  <div className="col-span-2 h-3 bg-gray-100 dark:bg-gray-700 rounded" />
                  <div className="col-span-2 h-5 bg-gray-100 dark:bg-gray-700 rounded-full w-20" />
                  <div className="col-span-2 h-3 bg-gray-100 dark:bg-gray-700 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="w-12 h-12 bg-red-50 dark:bg-red-900/20 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            <div>
              <p className="font-medium text-gray-900 dark:text-white">Could not load your articles</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-md">{loadError}</p>
              <p className="text-xs text-gray-400 mt-2">
                Your articles are still stored — this is a problem reading them, not missing data.
              </p>
            </div>
            <button
              onClick={fetchArticles}
              className="bg-brand-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
            >
              Try again
            </button>
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
        ) : statusFilter === 'cost' ? (
          <CostList articles={articles} />
        ) : (
          <div>
            {articles.map((article) => (
              <div
                key={article.id}
                className="px-6 py-4 border-b border-gray-50 dark:border-gray-700 last:border-0 hover:bg-gray-50/50 dark:hover:bg-gray-700/30 transition-colors"
              >
                <div className="grid grid-cols-12 gap-4 items-center">
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
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      {(article as any).sites?.name || '—'}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <Badge variant={statusToBadgeVariant(article.status)}>
                      {article.status}
                    </Badge>
                  </div>
                  <div className="col-span-2">
                    <ArticleWhen article={article} />
                  </div>
                  <div className="col-span-2 flex items-center gap-1 justify-end">
                    <Link
                      href={`/articles/${article.id}`}
                      className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                      title="Edit article"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Link>
                    {(article.node_post_url || article.wp_post_url) && (
                      <a
                        href={article.node_post_url || article.wp_post_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        title={article.node_post_url ? 'View live' : 'View on WordPress'}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                    <button
                      onClick={() => archiveArticle(article)}
                      disabled={archivingId === article.id}
                      className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
                      title="Move to Archive"
                    >
                      <Archive className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Internal spend per article, broken down by generation step. Never shown to a
 * client — this is what an article cost to make.
 */
function CostList({ articles }: { articles: Article[] }) {
  const grand = articles.reduce(
    (sum, a) => sum + (a.usage || []).reduce((n, u) => n + (u.cost_usd ?? 0), 0),
    0
  )
  const anyUnknown = articles.some((a) => (a.usage || []).some((u) => u.cost_usd === null))

  return (
    <div>
      <div className="px-6 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {articles.length} article{articles.length === 1 ? '' : 's'}
        </span>
        <span className="text-sm font-semibold text-gray-900 dark:text-white">
          Total {money(grand)}
          {anyUnknown && <span className="text-xs font-normal text-gray-400"> + unpriced steps</span>}
        </span>
      </div>

      {articles.map((article) => {
        const usage = article.usage || []
        const subtotal = usage.reduce((n, u) => n + (u.cost_usd ?? 0), 0)

        return (
          <div
            key={article.id}
            className="px-6 py-4 border-b border-gray-50 dark:border-gray-700 last:border-0"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Link
                  href={`/articles/${article.id}`}
                  className="font-medium text-gray-900 dark:text-gray-100 text-sm hover:text-brand-600"
                >
                  {article.title}
                </Link>
                <p className="text-xs text-gray-400 mt-0.5">
                  {/* In the article's own zone, like everywhere else — reading
                      these in the browser's local time made two articles on the
                      same slot look like they were hours apart. */}
                  {article.published_at
                    ? `Published: ${formatInZone(article.published_at, article.scheduled_tz || 'PST')}`
                    : article.scheduled_at
                    ? `Scheduled: ${formatInZone(article.scheduled_at, article.scheduled_tz || 'PST')}`
                    : 'Not scheduled'}
                </p>
              </div>
              <span className="text-sm font-semibold text-gray-900 dark:text-white flex-shrink-0">
                {usage.length ? money(subtotal) : '—'}
              </span>
            </div>

            {!usage.length ? (
              <p className="text-xs text-gray-400 mt-2">
                No AI usage recorded for this article.
              </p>
            ) : (
              <>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mt-3 mb-1">
                  AI Models Used:
                </p>
                <ol className="space-y-0.5">
                  {usage.map((u, i) => (
                    <li key={u.id} className="text-xs text-gray-500 dark:text-gray-400 flex gap-1.5">
                      <span className="tabular-nums text-gray-300 dark:text-gray-600">{i + 1}.</span>
                      <span>
                        <span className="text-gray-700 dark:text-gray-300">
                          {STEP_LABEL[u.step] || u.step}
                        </span>{' '}
                        <span className="font-mono">{u.model}</span>:{' '}
                        <span className="text-gray-900 dark:text-white font-medium">
                          {money(u.cost_usd)}
                        </span>
                        {u.total_tokens > 0 && (
                          <span className="text-gray-400">
                            {' '}({u.total_tokens.toLocaleString()} tokens)
                          </span>
                        )}
                        {u.cost_usd === null && (
                          <span className="text-gray-400"> (not priced per token)</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
