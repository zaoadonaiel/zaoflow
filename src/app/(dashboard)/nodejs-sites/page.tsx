'use client'

import { useState, useEffect, useCallback } from 'react'
import { Server, Plus, Trash2, RefreshCw, ExternalLink, CheckCircle2, XCircle, KeyRound } from 'lucide-react'
import Header from '@/components/layout/Header'
import AddNodeSiteModal from '@/components/sites/AddNodeSiteModal'
import EditCredentialsModal from '@/components/sites/EditCredentialsModal'
import Badge, { statusToBadgeVariant } from '@/components/ui/Badge'
import type { Site } from '@/types'
import toast from 'react-hot-toast'

export default function NodeJSSitesPage() {
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [editSite, setEditSite] = useState<Site | null>(null)

  const fetchSites = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sites')
      const data = await res.json()
      const nodeSites: Site[] = (data.sites || []).filter((s: Site) => s.site_type === 'nodejs')
      setSites(nodeSites)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSites() }, [fetchSites])

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
        title="Node JS Sites"
        subtitle="Connect your Node.js sites to schedule and publish AI-written blog posts."
        actions={
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Node.js site
          </button>
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
              <Server className="w-8 h-8 text-gray-400" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">No Node.js sites connected</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Connect your first Node.js site to start publishing</p>
            </div>
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 bg-brand-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors mt-2"
            >
              <Plus className="w-4 h-4" />
              Connect a site
            </button>
          </div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sites.map((site) => (
            <div key={site.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 hover:border-gray-200 dark:hover:border-gray-600 transition-all">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Server className="w-5 h-5 text-blue-600" />
                </div>
                <Badge variant={statusToBadgeVariant(site.status)}>
                  {site.status === 'connected' ? (
                    <CheckCircle2 className="w-3 h-3" />
                  ) : (
                    <XCircle className="w-3 h-3" />
                  )}
                  {site.status}
                </Badge>
              </div>

              <h3 className="font-semibold text-gray-900 dark:text-white mb-1">{site.name}</h3>
              <a
                href={site.node_api_url || site.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-brand-600 dark:hover:text-brand-400 flex items-center gap-1 transition-colors"
              >
                {(site.node_api_url || site.url).replace(/^https?:\/\//, '')}
                <ExternalLink className="w-3 h-3" />
              </a>

              {site.last_sync && (
                <p className="text-xs text-gray-400 mt-2">
                  Last sync: {new Date(site.last_sync).toLocaleDateString()}
                </p>
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
                <button
                  onClick={() => setEditSite(site)}
                  title="Edit credentials"
                  className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-lg transition-colors"
                >
                  <KeyRound className="w-3.5 h-3.5" />
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

      <AddNodeSiteModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onAdded={() => fetchSites()}
      />

      <EditCredentialsModal
        open={editSite !== null}
        site={editSite}
        onClose={() => setEditSite(null)}
        onSaved={() => fetchSites()}
      />
    </div>
  )
}
