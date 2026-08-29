'use client'

import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import { Globe, Loader2, AlertCircle, CheckCircle2, Copy, Code2 } from 'lucide-react'
import toast from 'react-hot-toast'
import type { GA4Property } from '@/types'

interface GA4Account {
  accountId: string
  displayName: string
}
interface GscSite {
  siteUrl: string
  permissionLevel: string
}

interface AddAnalyticsSiteModalProps {
  open: boolean
  onClose: () => void
  onDone: () => void
}

type Step = 'form' | 'connect' | 'success'
type ConnectMode = 'create' | 'existing'

export default function AddAnalyticsSiteModal({ open, onClose, onDone }: AddAnalyticsSiteModalProps) {
  const [step, setStep] = useState<Step>('form')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [siteId, setSiteId] = useState('')
  const [mode, setMode] = useState<ConnectMode>('create')
  const [loadingProps, setLoadingProps] = useState(false)
  const [needsReconnect, setNeedsReconnect] = useState(false)
  const [ga4Accounts, setGa4Accounts] = useState<GA4Account[]>([])
  const [ga4Properties, setGa4Properties] = useState<GA4Property[]>([])
  const [gscSites, setGscSites] = useState<GscSite[]>([])
  const [selectedAccount, setSelectedAccount] = useState('')
  const [selectedProperty, setSelectedProperty] = useState('')
  const [selectedGsc, setSelectedGsc] = useState('')
  const [measurementId, setMeasurementId] = useState<string | null>(null)

  function reset() {
    setStep('form')
    setName('')
    setUrl('')
    setLoading(false)
    setError('')
    setSiteId('')
    setMode('create')
    setGa4Accounts([])
    setGa4Properties([])
    setGscSites([])
    setSelectedAccount('')
    setSelectedProperty('')
    setSelectedGsc('')
    setMeasurementId(null)
  }

  function handleClose() {
    reset()
    onClose()
  }

  function validateUrl(raw: string) {
    try {
      const u = new URL(raw.trim())
      return u.protocol === 'https:' || u.protocol === 'http:'
    } catch {
      return false
    }
  }

  async function handleCreateSite(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { toast.error('Enter a site name'); return }
    if (!validateUrl(url)) { toast.error('Enter a valid URL (include https://)'); return }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_type: 'other', name, url }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to add site')
        return
      }

      setSiteId(data.site.id)
      setStep('connect')
      loadProperties()
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  async function loadProperties() {
    setLoadingProps(true)
    setError('')
    try {
      const res = await fetch('/api/google/properties')
      const data = await res.json()
      if (!res.ok) {
        setNeedsReconnect(!!data.reconnect)
        setError(data.error || 'Failed to load Google properties')
        return
      }
      setGa4Accounts(data.ga4Accounts || [])
      setGa4Properties(data.ga4Properties || [])
      setGscSites(data.gscSites || [])
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoadingProps(false)
    }
  }

  async function handleCreateProperty() {
    if (!selectedAccount) { toast.error('Choose a Google Analytics account'); return }
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/google/properties/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, accountId: selectedAccount, displayName: name, websiteUrl: url }),
      })
      const data = await res.json()

      if (!res.ok) {
        setNeedsReconnect(!!data.reconnect)
        setError(data.error || 'Failed to create GA4 property')
        return
      }

      setMeasurementId(data.measurementId)
      setStep('success')
      toast.success('GA4 property created')
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  async function handleUseExisting() {
    if (!selectedProperty) { toast.error('Choose a GA4 property'); return }
    setLoading(true)
    setError('')

    try {
      const res = await fetch(`/api/sites/${siteId}/analytics`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ga4_property_id: selectedProperty, gsc_site_url: selectedGsc || null }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to save analytics settings')
        return
      }

      setMeasurementId(data.site.ga4_measurement_id)
      setStep('success')
      toast.success('Site connected to Google Analytics')
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  const snippet = measurementId
    ? `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${measurementId}');
</script>`
    : ''

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(snippet)
      toast.success('Snippet copied to clipboard')
    } catch {
      toast.error('Could not copy snippet')
    }
  }

  function handleDone() {
    reset()
    onDone()
  }

  return (
    <Modal open={open} onClose={handleClose} title="Add Site to Analytics">
      {step === 'form' && (
        <form onSubmit={handleCreateSite} className="space-y-4">
          {error && (
            <div className="flex items-start gap-2.5 p-3.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Site name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Client Site"
              className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              <Globe className="w-4 h-4 inline-block mr-1 text-gray-400" />
              Website URL
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://yoursite.com"
              className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>
          <p className="text-xs text-gray-400">
            This adds a site tracked for Analytics only — not connected for AI publishing. You can
            still connect it for publishing later from Sites or Node JS Sites.
          </p>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={handleClose} className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="flex-1 bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {loading ? 'Adding...' : 'Continue'}
            </button>
          </div>
        </form>
      )}

      {step === 'connect' && (
        loadingProps ? (
          <div className="flex flex-col items-center gap-3 py-10">
            <Loader2 className="w-6 h-6 text-brand-600 animate-spin" />
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading Google properties...</p>
          </div>
        ) : needsReconnect ? (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <AlertCircle className="w-6 h-6 text-amber-600" />
            <p className="text-sm text-gray-500 dark:text-gray-400">Connect your Google account first, then try again.</p>
            <a href="/api/google/connect" className="mt-2 bg-brand-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors">
              Connect Google Account
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

            <div className="flex items-center bg-gray-50 dark:bg-gray-800 rounded-xl p-1 w-fit">
              <button onClick={() => setMode('create')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${mode === 'create' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>
                Create new property
              </button>
              <button onClick={() => setMode('existing')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${mode === 'existing' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>
                Use existing property
              </button>
            </div>

            {mode === 'create' ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Google Analytics account</label>
                  <select
                    value={selectedAccount}
                    onChange={(e) => setSelectedAccount(e.target.value)}
                    className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="">Select an account</option>
                    {ga4Accounts.map((a) => (
                      <option key={a.accountId} value={a.accountId}>{a.displayName}</option>
                    ))}
                  </select>
                  {ga4Accounts.length === 0 && (
                    <p className="text-xs text-gray-400 mt-1">No Google Analytics accounts found on this Google account.</p>
                  )}
                </div>
                <p className="text-xs text-gray-400">
                  Creates a new GA4 property named &quot;{name}&quot; with a web data stream for {url}.
                </p>
                <button
                  onClick={handleCreateProperty}
                  disabled={loading}
                  className="w-full bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
                >
                  {loading ? 'Creating property...' : 'Create GA4 property'}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">GA4 Property</label>
                  <select
                    value={selectedProperty}
                    onChange={(e) => setSelectedProperty(e.target.value)}
                    className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="">None</option>
                    {ga4Properties.map((p) => (
                      <option key={p.propertyId} value={p.propertyId}>{p.displayName} ({p.accountName})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Search Console Site (optional)</label>
                  <select
                    value={selectedGsc}
                    onChange={(e) => setSelectedGsc(e.target.value)}
                    className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="">None</option>
                    {gscSites.map((s) => (
                      <option key={s.siteUrl} value={s.siteUrl}>{s.siteUrl}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={handleUseExisting}
                  disabled={loading}
                  className="w-full bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
                >
                  {loading ? 'Saving...' : 'Connect property'}
                </button>
              </div>
            )}
          </div>
        )
      )}

      {step === 'success' && (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div className="w-12 h-12 bg-green-50 dark:bg-green-500/10 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">{name} is connected!</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Paste this snippet into your site&apos;s &lt;head&gt; to start tracking.
              </p>
            </div>
          </div>

          {measurementId ? (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                  <Code2 className="w-3.5 h-3.5" /> Tracking Snippet
                </span>
                <button onClick={handleCopy} className="flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">
                  <Copy className="w-3.5 h-3.5" /> Copy snippet
                </button>
              </div>
              <pre className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 text-xs font-mono text-gray-700 dark:text-gray-300 overflow-x-auto whitespace-pre">
                {snippet}
              </pre>
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
              Measurement ID wasn&apos;t returned yet — refresh Analytics in a moment to see it.
            </p>
          )}

          <button onClick={handleDone} className="w-full bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors">
            Done
          </button>
        </div>
      )}
    </Modal>
  )
}
