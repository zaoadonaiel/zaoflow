'use client'

import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import { Globe, Key, User, AlertCircle, ExternalLink, Copy, Check, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import type { Site } from '@/types'

interface EditCredentialsModalProps {
  open: boolean
  site: Site | null
  onClose: () => void
  onSaved: () => void
}

export default function EditCredentialsModal({ open, site, onClose, onSaved }: EditCredentialsModalProps) {
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [nodeApiUrl, setNodeApiUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!site) return
    setUrl(site.url ?? '')
    setUsername(site.wp_username ?? '')
    setAppPassword('')
    setNodeApiUrl(site.node_api_url ?? site.url ?? '')
    setError('')
    setCopied(false)
  }, [site, open])

  if (!site) return null

  function validateUrl(raw: string) {
    try {
      const u = new URL(raw.trim())
      return u.protocol === 'https:' || u.protocol === 'http:'
    } catch {
      return false
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!site) return
    setError('')

    const payload: Record<string, string> = {}

    if (site.site_type === 'wordpress') {
      if (!url.trim() || !validateUrl(url)) {
        setError('Enter a valid WordPress URL (include https://)')
        return
      }
      if (!username.trim()) {
        setError('Enter your WordPress username')
        return
      }
      payload.url = url.trim()
      payload.wp_username = username.trim()
      if (appPassword.trim()) payload.wp_app_password = appPassword.trim()
    } else if (site.site_type === 'nodejs') {
      if (!nodeApiUrl.trim() || !validateUrl(nodeApiUrl)) {
        setError('Enter a valid site URL (include https://)')
        return
      }
      payload.node_api_url = nodeApiUrl.trim()
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/sites/${site.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to update credentials')
        return
      }
      toast.success('Credentials updated')
      onSaved()
      onClose()
    } catch {
      setError('Network error — please try again')
    } finally {
      setSaving(false)
    }
  }

  async function copyToken() {
    if (!site?.secret_token) return
    try {
      await navigator.clipboard.writeText(site.secret_token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy — select and copy manually')
    }
  }

  const isOther = site.site_type === 'other'

  return (
    <Modal open={open} onClose={onClose} title={`Edit credentials — ${site.name}`}>
      {isOther ? (
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 p-3.5 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            This site type has no credentials to edit.
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="flex items-start gap-2.5 p-3.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {site.site_type === 'wordpress' && (
            <>
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
                  className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
              </div>

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
                  className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1">
                    <Key className="w-4 h-4 text-gray-400" />
                    Application password
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const clean = url.replace(/\/$/, '')
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
                  placeholder="Leave blank to keep current password"
                  className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent font-mono"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                  Only fill this in if you want to rotate the password. Otherwise leave blank.
                </p>
              </div>
            </>
          )}

          {site.site_type === 'nodejs' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  <Globe className="w-4 h-4 inline-block mr-1 text-gray-400" />
                  Node.js site URL
                </label>
                <input
                  type="url"
                  value={nodeApiUrl}
                  onChange={(e) => setNodeApiUrl(e.target.value)}
                  placeholder="https://yoursite.com"
                  className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  <Key className="w-4 h-4 inline-block mr-1 text-gray-400" />
                  API key
                </label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-xs font-mono text-gray-800 dark:text-gray-100 break-all">
                    {site.secret_token}
                  </code>
                  <button
                    type="button"
                    onClick={copyToken}
                    title="Copy"
                    className="flex-shrink-0 w-10 h-10 flex items-center justify-center border border-gray-200 dark:border-gray-600 rounded-xl text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                  Set this as <code className="font-mono font-semibold">ZAOFLO_API_KEY</code> in your site&apos;s environment.
                </p>
              </div>
            </>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {saving ? 'Testing & saving...' : 'Save & test'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
