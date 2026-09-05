'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { MapPin, Plus, Search, Trash2, ExternalLink, Globe, Pencil } from 'lucide-react'
import Header from '@/components/layout/Header'
import Badge, { statusToBadgeVariant } from '@/components/ui/Badge'
import type { SEOPage, Site } from '@/types'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

const STATUS_FILTERS = ['all', 'draft', 'scheduled', 'published', 'failed'] as const
type StatusFilter = typeof STATUS_FILTERS[number]

export default function SEOPagesPage() {
  const [pages, setPages] = useState<SEOPage[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sites, setSites] = useState<Site[]>([])
  const [siteFilter, setSiteFilter] = useState('all')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchPages = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (siteFilter !== 'all') params.set('site_id', siteFilter)
      const res = await fetch(`/api/seo-pages?${params}`)
      const data = await res.json()
      setPages(data.seoPages || [])
    } finally {
      setLoading(false)
    }
  }, [search, statusFilter, siteFilter])

  useEffect(() => { fetchPages() }, [fetchPages])

  useEffect(() => {
    fetch('/api/sites')
      .then((r) => r.json())
      .then((d) => setSites((d.sites || []).filter((s: Site) => s.site_type === 'wordpress')))
      .catch(() => {})
  }, [])

  async function deletePage(page: SEOPage) {
    if (!confirm(`Delete "${page.title}"? This removes the draft from Zao Flo. The WordPress post (if any) stays put.`)) return
    setDeletingId(page.id)
    try {
      const res = await fetch(`/api/seo-pages/${page.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Delete failed')
      setPages((prev) => prev.filter((p) => p.id !== page.id))
      toast.success('SEO page deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete SEO page')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div>
      <Header
        title="SEO Pages"
        subtitle="Clone a WordPress post for another city and rewrite it with AI"
        actions={
          <Link
            href="/seo-pages/new"
            className="flex items-center gap-2 bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New SEO page
          </Link>
        }
      />

      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search SEO pages..."
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
        </div>
        <div className="relative">
          <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <select
            value={siteFilter}
            onChange={(e) => setSiteFilter(e.target.value)}
            className="appearance-none pl-10 pr-8 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent cursor-pointer"
          >
            <option value="all">All WP sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
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

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="grid grid-cols-12 gap-4 text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
            <div className="col-span-4">Title</div>
            <div className="col-span-2">City</div>
            <div className="col-span-2">Site</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2"></div>
          </div>
        </div>

        {loading ? (
          <div className="space-y-0">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="px-6 py-4 border-b border-gray-50 dark:border-gray-700 animate-pulse">
                <div className="grid grid-cols-12 gap-4 items-center">
                  <div className="col-span-4 h-4 bg-gray-200 dark:bg-gray-700 rounded" />
                  <div className="col-span-2 h-3 bg-gray-100 dark:bg-gray-700 rounded" />
                  <div className="col-span-2 h-3 bg-gray-100 dark:bg-gray-700 rounded" />
                  <div className="col-span-2 h-5 bg-gray-100 dark:bg-gray-700 rounded-full w-20" />
                </div>
              </div>
            ))}
          </div>
        ) : pages.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="w-12 h-12 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center">
              <MapPin className="w-6 h-6 text-gray-400" />
            </div>
            <div>
              <p className="font-medium text-gray-900 dark:text-white">No SEO pages yet</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {search || statusFilter !== 'all' || siteFilter !== 'all' ? 'Try adjusting your filters' : 'Clone an existing WordPress post for a new city to get started'}
              </p>
            </div>
            {!search && statusFilter === 'all' && siteFilter === 'all' && (
              <Link
                href="/seo-pages/new"
                className="flex items-center gap-2 bg-brand-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                New SEO page
              </Link>
            )}
          </div>
        ) : (
          <div>
            {pages.map((page) => (
              <div
                key={page.id}
                className="px-6 py-4 border-b border-gray-50 dark:border-gray-700 last:border-0 hover:bg-gray-50/50 dark:hover:bg-gray-700/30 transition-colors"
              >
                <div className="grid grid-cols-12 gap-4 items-center">
                  <div className="col-span-4">
                    <Link
                      href={`/seo-pages/${page.id}`}
                      className="font-medium text-gray-900 dark:text-gray-100 text-sm hover:text-brand-600 dark:hover:text-brand-400 transition-colors line-clamp-1"
                    >
                      {page.title}
                    </Link>
                    {page.slug && (
                      <p className="text-xs text-gray-400 mt-0.5 truncate">/{page.slug}</p>
                    )}
                  </div>
                  <div className="col-span-2">
                    <span className="text-sm text-gray-500 dark:text-gray-400 truncate block">
                      {page.target_city || '—'}
                    </span>
                    {page.source_city && (
                      <p className="text-[10px] text-gray-400 mt-0.5">from {page.source_city}</p>
                    )}
                  </div>
                  <div className="col-span-2">
                    <span className="text-sm text-gray-500 dark:text-gray-400 truncate block">
                      {page.sites?.name || '—'}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <Badge variant={statusToBadgeVariant(page.status)}>{page.status}</Badge>
                    {page.status === 'scheduled' && page.scheduled_at && (
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {format(new Date(page.scheduled_at), 'MMM d, yyyy')}
                      </p>
                    )}
                  </div>
                  <div className="col-span-2 flex items-center gap-1 justify-end">
                    <Link
                      href={`/seo-pages/${page.id}`}
                      className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                      title="Edit SEO page"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Link>
                    {page.wp_page_url && (
                      <a
                        href={page.wp_page_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        title="View live"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                    <button
                      onClick={() => deletePage(page)}
                      disabled={deletingId === page.id}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
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
