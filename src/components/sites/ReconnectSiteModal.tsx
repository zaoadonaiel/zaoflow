'use client'

import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import { Globe, Key, User, AlertCircle, Loader2, ExternalLink, ChevronDown, ChevronUp, Zap, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import type { Site } from '@/types'

interface ReconnectSiteModalProps {
  open: boolean
  onClose: () => void
  site: Site
  /** Called with the refreshed row so the card can update without a full refetch. */
  onReconnected: (site: Site) => void
}

type Method = 'auto' | 'manual'

/**
 * Swaps in fresh WordPress credentials for a site that is already in the list.
 *
 * Deliberately not a re-add: the site keeps its id, so its articles, schedules,
 * knowledge base and analytics links all stay attached.
 */
export default function ReconnectSiteModal({ open, onClose, site, onReconnected }: ReconnectSiteModalProps) {
  const [method, setMethod] = useState<Method>('auto')
  const [url, setUrl] = useState(site.url)
  const [username, setUsername] = useState(site.wp_username || '')
  const [appPassword, setAppPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function handleClose() {
    setMethod('auto')
    setUrl(site.url)
    setUsername(site.wp_username || '')
    setAppPassword('')
    setError('')
    setLoading(false)
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

  function handleConnectWithWordPress() {
    if (!url.trim()) { toast.error('Enter your WordPress URL first'); return }
    if (!validateUrl(url)) { toast.error('Enter a valid URL (include https://)'); return }

    const cleanUrl = url.trim().replace(/\/$/, '')
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin
    // site_id instead of site_name — the callback updates this row rather than
    // inserting a second one for the same site.
    const successUrl = `${appUrl}/api/wp-auth/callback?site_id=${encodeURIComponent(site.id)}`
    const rejectUrl = `${appUrl}/sites?wp_error=rejected`
    const appId = crypto.randomUUID()

    const authUrl = `${cleanUrl}/wp-admin/authorize-application.php?` +
      `app_name=${encodeURIComponent('Zao Flo')}&` +
      `app_id=${appId}&` +
      `success_url=${encodeURIComponent(successUrl)}&` +
      `reject_url=${encodeURIComponent(rejectUrl)}`

    window.location.href = authUrl
  }

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch(`/api/sites/${site.id}/reconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, wp_username: username, wp_app_password: appPassword }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to reconnect site')
        return
      }

      toast.success(`${site.name} reconnected — nothing else changed`)
      onReconnected(data.site)
      handleClose()
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title={`Reconnect ${site.name}`}>
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 p-3.5 bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-900/40 rounded-xl text-xs text-green-700 dark:text-green-300">
          <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p>
            Only the login credentials are replaced. Your articles, schedules, knowledge
            base and analytics connections for this site stay exactly as they are.
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2.5 p-3.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 rounded-xl text-sm text-red-700 dark:text-red-300">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            <Globe className="w-4 h-4 inline-block mr-1 text-gray-400" />
            WordPress URL
          </label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://yoursite.com"
            className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
            Change this only if the site itself moved to a new address.
          </p>
        </div>

        {method === 'auto' && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={handleConnectWithWordPress}
              className="w-full flex items-center justify-center gap-2.5 bg-brand-600 text-white px-4 py-3 rounded-xl text-sm font-semibold hover:bg-brand-700 transition-colors shadow-sm"
            >
              <Zap className="w-4 h-4" />
              Reconnect with WordPress
              <ExternalLink className="w-3.5 h-3.5 opacity-70" />
            </button>

            <div className="p-3.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/40 rounded-xl text-xs text-blue-700 dark:text-blue-300 space-y-1.5">
              <p className="font-medium text-blue-800 dark:text-blue-200">How it works</p>
              <ol className="list-decimal list-inside space-y-0.5 ml-1">
                <li>Log in to WordPress as the user you want Zao Flo to publish as</li>
                <li>Approve the Zao Flo application password</li>
                <li>You come straight back here, reconnected</li>
              </ol>
              <p className="text-blue-600 dark:text-blue-400 mt-1">
                The old application password stays in WordPress until you revoke it under Users → Profile.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
              <span className="text-xs text-gray-400 dark:text-gray-500">or</span>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
            </div>

            <button
              type="button"
              onClick={() => setMethod('manual')}
              className="w-full flex items-center justify-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors py-1"
            >
              Enter new credentials manually
              <ChevronDown className="w-3.5 h-3.5" />
            </button>

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {method === 'manual' && (
          <form onSubmit={handleManualSubmit} className="space-y-4">
            <button
              type="button"
              onClick={() => setMethod('auto')}
              className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 font-medium transition-colors"
            >
              <ChevronUp className="w-3.5 h-3.5" />
              Use automatic reconnection instead
            </button>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                <User className="w-4 h-4 inline-block mr-1 text-gray-400" />
                WordPress username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                required
                className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1">
                  <Key className="w-4 h-4 text-gray-400" />
                  New Application Password
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const clean = url.trim().replace(/\/$/, '')
                    if (!clean) { toast.error('Enter your WordPress URL first'); return }
                    window.open(`${clean}/wp-admin/profile.php#application-passwords-section`, '_blank')
                  }}
                  className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium hover:underline transition-colors"
                >
                  Generate in WordPress
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
              <input
                type="password"
                value={appPassword}
                onChange={(e) => setAppPassword(e.target.value)}
                placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
                required
                className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent font-mono"
              />
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-2 bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
              >
                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {loading ? 'Verifying...' : 'Save new credentials'}
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  )
}
