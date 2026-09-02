'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Globe, Plus, Trash2, RefreshCw, ExternalLink, CheckCircle2, XCircle, Calendar, BookMarked, Server, KeyRound } from 'lucide-react'
import Header from '@/components/layout/Header'
import AddSiteModal from '@/components/sites/AddSiteModal'
import AddNodeSiteModal from '@/components/sites/AddNodeSiteModal'
import ReconnectSiteModal from '@/components/sites/ReconnectSiteModal'
import Badge, { statusToBadgeVariant } from '@/components/ui/Badge'
import ScheduleCalendarOverview from '@/components/schedules/ScheduleCalendarOverview'
import KnowledgeBaseModal from '@/components/sites/KnowledgeBaseModal'
import type { Site } from '@/types'
import toast from 'react-hot-toast'

export default function SitesPage() {
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [showAddNode, setShowAddNode] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  // Which site's publishing calendar is open, if any.
  const [calendarFor, setCalendarFor] = useState<Site | null>(null)
  // Which site's knowledge base is open, if any.
  const [knowledgeFor, setKnowledgeFor] = useState<Site | null>(null)
  // Which site is having its WordPress credentials swapped, if any.
  const [reconnectFor, setReconnectFor] = useState<Site | null>(null)
  const [authorSavingId, setAuthorSavingId] = useState<string | null>(null)
  const [authorRefreshingId, setAuthorRefreshingId] = useState<string | null>(null)
  const searchParams = useSearchParams()
  const router = useRouter()

  const fetchSites = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sites')
      const data = await res.json()
      setSites(data.sites || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSites() }, [fetchSites])

  // The plus in the header can ask for the add-site form from any page; it
  // arrives as ?new=1 because the form lives here.
  useEffect(() => {
    if (searchParams.get('new')) {
      setShowAdd(true)
      router.replace('/sites')
    }
  }, [searchParams, router])

  // Handle WordPress OAuth callback result
  useEffect(() => {
    const connected = searchParams.get('wp_connected')
    const reconnected = searchParams.get('wp_reconnected')
    const error = searchParams.get('wp_error')
    // Already decoded by searchParams — the callback sends the reason the test failed.
    const message = searchParams.get('wp_message')
    if (connected) {
      toast.success(`${decodeURIComponent(connected)} connected successfully!`)
      fetchSites()
      router.replace('/sites')
    } else if (reconnected) {
      toast.success(`${decodeURIComponent(reconnected)} reconnected — articles and schedules kept`)
      fetchSites()
      router.replace('/sites')
    } else if (error === 'reconnect_failed') {
      // Nothing was written — the site still holds its previous credentials.
      toast.error(
        message
          ? `${message} Your existing credentials were left in place.`
          : 'Those credentials did not work — your existing ones were left in place.',
        { duration: 10000 }
      )
      router.replace('/sites')
    } else if (error === 'rejected') {
      toast.error('Authorization was cancelled in WordPress')
      router.replace('/sites')
    } else if (error === 'test_failed') {
      toast.error(message || 'WordPress granted access, but the connection test failed.', {
        duration: 10000,
      })
      // The site was saved, flagged as errored — show it so Test can be retried.
      fetchSites()
      router.replace('/sites')
    } else if (error) {
      toast.error(message || 'Could not save site — please try again')
      router.replace('/sites')
    }
  }, [searchParams, fetchSites, router])

  async function deleteSite(id: string, name: string) {
    if (!confirm(`Remove "${name}"? Articles linked to this site will remain as drafts.`)) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/sites/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      setSites((prev) => prev.filter((s) => s.id !== id))
      toast.success(`${name} removed`)
    } catch {
      toast.error('Failed to remove site')
    } finally {
      setDeletingId(null)
    }
  }

  // Which author WordPress attributes the post to no longer depends on which
  // account authorized the connection — this saves that choice independently,
  // without touching credentials.
  async function setDefaultAuthor(site: Site, authorId: number | null) {
    setAuthorSavingId(site.id)
    try {
      const res = await fetch(`/api/sites/${site.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wp_default_author_id: authorId }),
      })
      if (!res.ok) throw new Error('Failed to save')
      setSites((prev) => prev.map((s) => (s.id === site.id ? { ...s, wp_default_author_id: authorId } : s)))
      toast.success('Default author updated')
    } catch {
      toast.error('Failed to update default author')
    } finally {
      setAuthorSavingId(null)
    }
  }

  async function refreshAuthors(site: Site) {
    setAuthorRefreshingId(site.id)
    try {
      const res = await fetch(`/api/sites/${site.id}/authors`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Failed to load authors'); return }
      setSites((prev) => prev.map((s) => (s.id === site.id ? { ...s, wp_authors: data.authors } : s)))
      toast.success('Author list refreshed')
    } catch {
      toast.error('Failed to load authors')
    } finally {
      setAuthorRefreshingId(null)
    }
  }

  async function testConnection(site: Site) {
    setTestingId(site.id)
    try {
      const res = await fetch(`/api/sites/${site.id}/test`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        toast.success('Connection verified!')
        fetchSites()
      } else {
        toast.error(data.error || 'Connection failed')
      }
    } finally {
      setTestingId(null)
    }
  }

  return (
    <div>
      <Header
        title="Sites"
        subtitle="Manage your connected WordPress sites"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add WordPress site
            </button>
            <button
              onClick={() => setShowAddNode(true)}
              className="flex items-center gap-2 bg-gray-900 dark:bg-gray-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-600 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Node.js site
            </button>
          </div>
        }
      />

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 animate-pulse">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-3" />
              <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-3/4 mb-2" />
              <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : sites.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 border-dashed">
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-2xl flex items-center justify-center">
              <Globe className="w-8 h-8 text-gray-400" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">No sites connected</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Connect your first WordPress or Node.js site to start publishing</p>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-2 bg-brand-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                WordPress site
              </button>
              <button
                onClick={() => setShowAddNode(true)}
                className="flex items-center gap-2 bg-gray-900 dark:bg-gray-700 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-600 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Node.js site
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sites.map((site) => (
            <div key={site.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 hover:border-gray-200 dark:hover:border-gray-600 transition-all">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
                  {site.site_type === 'nodejs' ? (
                    <Server className="w-5 h-5 text-blue-600" />
                  ) : (
                    <Globe className="w-5 h-5 text-blue-600" />
                  )}
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <Badge variant={statusToBadgeVariant(site.status)}>
                    {site.status === 'connected' ? (
                      <CheckCircle2 className="w-3 h-3" />
                    ) : (
                      <XCircle className="w-3 h-3" />
                    )}
                    {site.status}
                  </Badge>
                  <Badge variant={site.site_type === 'nodejs' ? 'purple' : 'default'}>
                    {site.site_type === 'nodejs' ? 'Node.js' : 'WordPress'}
                  </Badge>
                </div>
              </div>

              <h3 className="font-semibold text-gray-900 dark:text-white mb-1">{site.name}</h3>
              <a
                href={site.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-brand-600 dark:hover:text-brand-400 flex items-center gap-1 transition-colors"
              >
                {site.url.replace(/^https?:\/\//, '')}
                <ExternalLink className="w-3 h-3" />
              </a>

              {site.last_sync && (
                <p className="text-xs text-gray-400 mt-2">
                  Last sync: {new Date(site.last_sync).toLocaleDateString()}
                </p>
              )}

              {site.site_type === 'wordpress' && (
                <div className="mt-3 pt-3 border-t border-gray-50 dark:border-gray-700">
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Post as
                  </label>
                  {site.wp_authors && site.wp_authors.length > 0 ? (
                    <select
                      value={site.wp_default_author_id ?? ''}
                      disabled={authorSavingId === site.id}
                      onChange={(e) => setDefaultAuthor(site, e.target.value ? Number(e.target.value) : null)}
                      className="w-full px-2.5 py-1.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                      <option value="">Whoever authorized the connection</option>
                      {site.wp_authors.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  ) : (
                    <button
                      onClick={() => refreshAuthors(site)}
                      disabled={authorRefreshingId === site.id}
                      className="text-xs text-brand-600 hover:text-brand-700 font-medium disabled:opacity-50"
                    >
                      {authorRefreshingId === site.id ? 'Loading authors...' : 'Load author list'}
                    </button>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-50 dark:border-gray-700">
                <button
                  onClick={() => testConnection(site)}
                  disabled={testingId === site.id}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${testingId === site.id ? 'spin' : ''}`} />
                  {testingId === site.id ? 'Testing...' : 'Test'}
                </button>
                {site.site_type === 'wordpress' && (
                  <button
                    onClick={() => setReconnectFor(site)}
                    title={`Reconnect ${site.name} with new credentials`}
                    aria-label={`Reconnect ${site.name} with new credentials`}
                    className="flex items-center justify-center py-2 px-3 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-lg transition-colors"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => setKnowledgeFor(site)}
                  title={`Knowledge base for ${site.name}`}
                  aria-label={`Knowledge base for ${site.name}`}
                  className="flex items-center justify-center py-2 px-3 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-lg transition-colors"
                >
                  <BookMarked className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setCalendarFor(site)}
                  title={`Publishing calendar for ${site.name}`}
                  aria-label={`Publishing calendar for ${site.name}`}
                  className="flex items-center justify-center py-2 px-3 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-lg transition-colors"
                >
                  <Calendar className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => deleteSite(site.id, site.name)}
                  disabled={deletingId === site.id}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-medium text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Keyed on the site so switching cards refetches rather than showing
          the previous site's queue while the new one loads. */}
      {calendarFor && (
        <ScheduleCalendarOverview
          key={calendarFor.id}
          open
          onClose={() => setCalendarFor(null)}
          siteId={calendarFor.id}
          siteName={calendarFor.name}
        />
      )}

      {/* Keyed on the site so switching cards reloads that site's text rather
          than showing the previous one's while the new one loads. */}
      {knowledgeFor && (
        <KnowledgeBaseModal
          key={knowledgeFor.id}
          open
          onClose={() => setKnowledgeFor(null)}
          siteId={knowledgeFor.id}
          siteName={knowledgeFor.name}
          onSaved={(knowledge_base) =>
            setSites((prev) =>
              prev.map((s) => (s.id === knowledgeFor.id ? { ...s, knowledge_base } : s))
            )
          }
        />
      )}

      {/* Keyed on the site so the form fields reset to the right site's URL and
          username when a different card is opened. */}
      {reconnectFor && (
        <ReconnectSiteModal
          key={reconnectFor.id}
          open
          onClose={() => setReconnectFor(null)}
          site={reconnectFor}
          onReconnected={(updated) =>
            setSites((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
          }
        />
      )}

      <AddSiteModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onAdded={() => {
          setShowAdd(false)
          fetchSites()
        }}
      />

      <AddNodeSiteModal
        open={showAddNode}
        onClose={() => setShowAddNode(false)}
        onAdded={() => fetchSites()}
      />
    </div>
  )
}
