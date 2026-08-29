'use client'

import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import { Globe, Key, User, CheckCircle2, AlertCircle, Loader2, ExternalLink, ChevronDown, ChevronUp, Zap } from 'lucide-react'
import toast from 'react-hot-toast'

interface AddSiteModalProps {
  open: boolean
  onClose: () => void
  onAdded: () => void
}

type Step = 'form' | 'testing' | 'success'
type Method = 'auto' | 'manual'

export default function AddSiteModal({ open, onClose, onAdded }: AddSiteModalProps) {
  const [step, setStep] = useState<Step>('form')
  const [method, setMethod] = useState<Method>('auto')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [testError, setTestError] = useState('')

  function reset() {
    setStep('form')
    setMethod('auto')
    setName('')
    setUrl('')
    setUsername('')
    setAppPassword('')
    setTestError('')
    setLoading(false)
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

  function handleConnectWithWordPress() {
    if (!name.trim()) { toast.error('Enter a site name first'); return }
    if (!url.trim()) { toast.error('Enter your WordPress URL first'); return }
    if (!validateUrl(url)) { toast.error('Enter a valid URL (include https://)'); return }

    const cleanUrl = url.replace(/\/$/, '')
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin
    const successUrl = `${appUrl}/api/wp-auth/callback?site_name=${encodeURIComponent(name.trim())}`
    const rejectUrl = `${appUrl}/sites?wp_error=rejected`
    const appId = crypto.randomUUID()

    const authUrl = `${cleanUrl}/wp-admin/authorize-application.php?` +
      `app_name=${encodeURIComponent('Zao Flo')}&` +
      `app_id=${appId}&` +
      `success_url=${encodeURIComponent(successUrl)}&` +
      `reject_url=${encodeURIComponent(rejectUrl)}`

    // Navigate in same window — WordPress redirects back to our callback which then
    // redirects to /sites. Session cookie persists across the redirect chain.
    window.location.href = authUrl
  }

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setTestError('')
    setStep('testing')

    try {
      const res = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url, wp_username: username, wp_app_password: appPassword }),
      })

      const data = await res.json()

      if (!res.ok) {
        setTestError(data.error || 'Failed to add site')
        setStep('form')
        return
      }

      setStep('success')
      toast.success(`${name} connected successfully!`)
      onAdded()
    } catch {
      setTestError('Network error — please try again')
      setStep('form')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Connect WordPress Site">
      {step === 'testing' && (
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="w-12 h-12 bg-brand-50 dark:bg-brand-900/30 rounded-full flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-brand-600 animate-spin" />
          </div>
          <div className="text-center">
            <p className="font-medium text-gray-900 dark:text-white">Testing connection...</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Verifying your WordPress credentials</p>
          </div>
        </div>
      )}

      {step === 'success' && (
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="w-12 h-12 bg-green-50 dark:bg-green-900/30 rounded-full flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6 text-green-600" />
          </div>
          <div className="text-center">
            <p className="font-semibold text-gray-900 dark:text-white">Site connected!</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{name} is ready for publishing.</p>
          </div>
          <button
            onClick={handleClose}
            className="mt-2 bg-brand-600 text-white px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            Done
          </button>
        </div>
      )}

      {step === 'form' && (
        <div className="space-y-4">
          {testError && (
            <div className="flex items-start gap-2.5 p-3.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 rounded-xl text-sm text-red-700 dark:text-red-300">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {testError}
            </div>
          )}

          {/* Common fields */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Site name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Blog"
              className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>

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
          </div>

          {/* Auto connect (primary) */}
          {method === 'auto' && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleConnectWithWordPress}
                className="w-full flex items-center justify-center gap-2.5 bg-brand-600 text-white px-4 py-3 rounded-xl text-sm font-semibold hover:bg-brand-700 transition-colors shadow-sm"
              >
                <Zap className="w-4 h-4" />
                Connect with WordPress
                <ExternalLink className="w-3.5 h-3.5 opacity-70" />
              </button>

              <div className="p-3.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/40 rounded-xl text-xs text-blue-700 dark:text-blue-300 space-y-1.5">
                <p className="font-medium text-blue-800 dark:text-blue-200">How it works</p>
                <ol className="list-decimal list-inside space-y-0.5 ml-1">
                  <li>You&apos;ll be taken to your WordPress admin to log in</li>
                  <li>WordPress asks you to approve Zao Flo access</li>
                  <li>Click <strong>Yes, Grant Access</strong> — you&apos;re done!</li>
                </ol>
                <p className="text-blue-600 dark:text-blue-400 mt-1">No copy-pasting required. Works on any WordPress 5.6+ site.</p>
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
                Enter credentials manually
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Manual entry (fallback) */}
          {method === 'manual' && (
            <form onSubmit={handleManualSubmit} className="space-y-4">
              <button
                type="button"
                onClick={() => setMethod('auto')}
                className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 font-medium transition-colors"
              >
                <ChevronUp className="w-3.5 h-3.5" />
                Use automatic connection instead
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
                    Application Password
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
                  className="flex-1 bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
                >
                  {loading ? 'Connecting...' : 'Connect site'}
                </button>
              </div>
            </form>
          )}

          {method === 'auto' && (
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
