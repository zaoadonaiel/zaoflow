'use client'

import { Suspense, useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Archive, ArchiveRestore, Loader2, ExternalLink, Globe, Lightbulb, PenLine,
} from 'lucide-react'
import Header from '@/components/layout/Header'
import type { Article, ArchivedIdea, Site } from '@/types'
import { ALL_SITES } from '@/lib/site-filter'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

type Tab = 'articles' | 'ideas'

export default function ArchivePage() {
  return (
    <Suspense fallback={null}>
      <ArchiveTabs />
    </Suspense>
  )
}

/**
 * Everything taken out of the working lists: articles you archived, and ideas
 * you regenerated away from.
 *
 * Neither tab has a delete. The point of the archive is that what lands here
 * survives — an idea leaves it by being written, and an article by being
 * restored, and there is no third way out to press by accident.
 */
function ArchiveTabs() {
  const router = useRouter()
  // Deep-linked from the idea generator, which says where a turned-down idea
  // went and links straight to it.
  const initialTab: Tab = useSearchParams().get('tab') === 'ideas' ? 'ideas' : 'articles'

  const [tab, setTab] = useState<Tab>(initialTab)
  const [articles, setArticles] = useState<Article[]>([])
  const [ideas, setIdeas] = useState<ArchivedIdea[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [sites, setSites] = useState<Site[]>([])
  const [siteFilter, setSiteFilter] = useState(ALL_SITES)
  const [ideasError, setIdeasError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/sites')
      .then((r) => r.json())
      .then((d) => setSites(d.sites || []))
      .catch(() => {})
  }, [])

  // Both lists load together whichever tab is showing, so the counts on the
  // tabs are true before you have been to the other one.
  const fetchArchive = useCallback(async () => {
    setLoading(true)
    const site = siteFilter !== ALL_SITES ? siteFilter : ''

    const articleParams = new URLSearchParams({ archived: 'true' })
    if (site) articleParams.set('site_id', site)
    const ideaParams = new URLSearchParams()
    if (site) ideaParams.set('site_id', site)

    const [articleRes, ideaRes] = await Promise.allSettled([
      fetch(`/api/articles?${articleParams}`).then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d.error || 'Could not load the archive')
        return d.articles || []
      }),
      fetch(`/api/ideas/archive?${ideaParams}`).then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d.error || 'Could not load the ideas')
        return d.ideas || []
      }),
    ])

    if (articleRes.status === 'fulfilled') setArticles(articleRes.value)
    else toast.error(articleRes.reason?.message || 'Could not load the archive')

    if (ideaRes.status === 'fulfilled') {
      setIdeas(ideaRes.value)
      setIdeasError(null)
    } else {
      // Shown in the tab rather than as a toast: it is that tab that is empty,
      // and the reason belongs where the ideas would have been.
      setIdeas([])
      setIdeasError(ideaRes.reason?.message || 'Could not load the ideas')
    }

    setLoading(false)
  }, [siteFilter])

  useEffect(() => { fetchArchive() }, [fetchArchive])

  async function restore(id: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/articles/${id}/schedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: false }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Restore failed')
      toast.success('Restored')
      if (data.wpWarning) toast.error(`WordPress: ${data.wpWarning}`, { duration: 8000 })
      await fetchArchive()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Restore failed')
    } finally {
      setBusyId(null)
    }
  }

  const siteName = sites.find((s) => s.id === siteFilter)?.name ?? 'this site'
  const counts: Record<Tab, number> = { articles: articles.length, ideas: ideas.length }

  return (
    <>
      <Header
        title="Archive"
        subtitle={
          tab === 'articles'
            ? 'Articles you have taken out of the working lists'
            : 'Ideas you turned down, kept in case you want them later'
        }
      />

      <div className="p-6 max-w-5xl">
        <div className="mb-5">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Site</label>
          <div className="relative max-w-sm">
            <Globe className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
              className="w-full h-11 pl-9 pr-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white appearance-none"
            >
              <option value={ALL_SITES}>All sites</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="inline-flex rounded-xl border border-gray-200 dark:border-gray-700 p-1 bg-white dark:bg-gray-800 mb-5">
          {(['articles', 'ideas'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 h-9 rounded-lg text-sm font-medium capitalize transition-colors ${
                tab === t
                  ? 'bg-brand-600 text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              {t}
              {!loading && (
                <span className={`ml-1.5 tabular-nums font-normal ${
                  tab === t ? 'text-white/70' : 'text-gray-400 dark:text-gray-500'
                }`}>
                  ({counts[t].toLocaleString()})
                </span>
              )}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : tab === 'articles' ? (
          !articles.length ? (
            <Empty icon={<Archive className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />}>
              {siteFilter === ALL_SITES
                ? 'Nothing archived.'
                : `Nothing archived for ${siteName}.`}
            </Empty>
          ) : (
            <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700 overflow-hidden">
              {articles.map((a) => (
                <div key={a.id} className="flex items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{a.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {a.sites?.name ? `${a.sites.name} · ` : ''}
                      Archived {a.archived_at ? format(new Date(a.archived_at), 'MMM d, yyyy') : '—'}
                    </p>
                  </div>
                  {a.wp_post_url && (
                    <a
                      href={a.wp_post_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-gray-100 dark:hover:bg-gray-700"
                      title="View on WordPress"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                  <button
                    onClick={() => restore(a.id)}
                    disabled={busyId === a.id}
                    className="p-2 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
                    title="Restore"
                  >
                    {busyId === a.id
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <ArchiveRestore className="w-4 h-4" />}
                  </button>
                </div>
              ))}
            </div>
          )
        ) : ideasError ? (
          <Empty icon={<Lightbulb className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />}>
            {ideasError}
          </Empty>
        ) : !ideas.length ? (
          <Empty icon={<Lightbulb className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />}>
            {siteFilter === ALL_SITES
              ? 'No turned-down ideas yet. Regenerate one and it is kept here.'
              : `No turned-down ideas for ${siteName} yet.`}
          </Empty>
        ) : (
          <div className="space-y-3">
            {ideas.map((idea) => (
              <div
                key={idea.id}
                className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-800 p-5"
              >
                <div className="flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-900 dark:text-white">{idea.title}</p>
                    {idea.description && (
                      <p className="text-sm text-gray-600 dark:text-gray-300 mt-1.5">{idea.description}</p>
                    )}
                    {idea.keywords?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {idea.keywords.map((k) => (
                          <span
                            key={k}
                            className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-700 text-xs text-gray-600 dark:text-gray-300"
                          >
                            {k}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-gray-400 mt-3">
                      {idea.sites?.name ? `${idea.sites.name} · ` : ''}
                      Turned down {format(new Date(idea.created_at), 'MMM d, yyyy')}
                    </p>
                  </div>

                  {/* The only way out of the archive: writing it. The idea is
                      carried into a new article and stops being a suggestion. */}
                  <button
                    onClick={() => router.push(`/articles/new?idea=${idea.id}`)}
                    className="flex items-center gap-2 flex-shrink-0 bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-brand-700 transition-colors"
                  >
                    <PenLine className="w-3.5 h-3.5" />
                    Write this
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function Empty({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 py-16 text-center">
      {icon}
      <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto px-6">{children}</p>
    </div>
  )
}
