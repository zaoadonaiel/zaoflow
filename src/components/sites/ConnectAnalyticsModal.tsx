'use client'

import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import { Loader2, AlertCircle, BarChart3 } from 'lucide-react'
import toast from 'react-hot-toast'
import type { Site, GA4Property } from '@/types'

interface GscSite {
  siteUrl: string
  permissionLevel: string
}

interface ConnectAnalyticsModalProps {
  open: boolean
  site: Site | null
  onClose: () => void
  onSaved: () => void
}

export default function ConnectAnalyticsModal({ open, site, onClose, onSaved }: ConnectAnalyticsModalProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [needsReconnect, setNeedsReconnect] = useState(false)
  const [ga4Properties, setGa4Properties] = useState<GA4Property[]>([])
  const [gscSites, setGscSites] = useState<GscSite[]>([])
  const [selectedGa4, setSelectedGa4] = useState('')
  const [selectedGsc, setSelectedGsc] = useState('')

  useEffect(() => {
    if (!open || !site) return

    setLoading(true)
    setError('')
    setNeedsReconnect(false)
    setSelectedGa4(site.ga4_property_id || '')
    setSelectedGsc(site.gsc_site_url || '')

    fetch('/api/google/properties')
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) {
          setNeedsReconnect(!!data.reconnect)
          setError(data.error || 'Failed to load Google properties')
          return
        }
        setGa4Properties(data.ga4Properties || [])
        setGscSites(data.gscSites || [])
      })
      .catch(() => setError('Network error — please try again'))
      .finally(() => setLoading(false))
  }, [open, site])

  async function handleSave() {
    if (!site) return
    setSaving(true)

    try {
      const res = await fetch(`/api/sites/${site.id}/analytics`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ga4_property_id: selectedGa4 || null,
          gsc_site_url: selectedGsc || null,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Failed to save analytics settings')
        return
      }

      toast.success('Analytics settings saved')
      onSaved()
      onClose()
    } catch {
      toast.error('Network error — please try again')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Connect Analytics${site ? ` — ${site.name}` : ''}`}>
      {loading ? (
        <div className="flex flex-col items-center gap-3 py-10">
          <Loader2 className="w-6 h-6 text-brand-600 animate-spin" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading Google properties...</p>
        </div>
      ) : needsReconnect ? (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <div className="w-12 h-12 bg-amber-50 dark:bg-amber-500/10 rounded-full flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-amber-600" />
          </div>
          <div>
            <p className="font-medium text-gray-900 dark:text-white">Google account not connected</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Connect your Google account to map GA4 and Search Console properties.
            </p>
          </div>
          <a
            href="/api/google/connect"
            className="mt-2 flex items-center gap-2 bg-brand-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            <BarChart3 className="w-4 h-4" />
            Reconnect Google Account
          </a>
        </div>
      ) : (
        <div className="space-y-4">
          {error && (
            <div className="flex items-start gap-2.5 p-3.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              GA4 Property
            </label>
            <select
              value={selectedGa4}
              onChange={(e) => setSelectedGa4(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            >
              <option value="">None</option>
              {ga4Properties.map((p) => (
                <option key={p.propertyId} value={p.propertyId}>
                  {p.displayName} ({p.accountName})
                </option>
              ))}
            </select>
            {ga4Properties.length === 0 && (
              <p className="text-xs text-gray-400 mt-1">No GA4 properties found on this Google account.</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Search Console Site
            </label>
            <select
              value={selectedGsc}
              onChange={(e) => setSelectedGsc(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            >
              <option value="">None</option>
              {gscSites.map((s) => (
                <option key={s.siteUrl} value={s.siteUrl}>
                  {s.siteUrl}
                </option>
              ))}
            </select>
            {gscSites.length === 0 && (
              <p className="text-xs text-gray-400 mt-1">No verified Search Console sites found.</p>
            )}
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex-1 bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
