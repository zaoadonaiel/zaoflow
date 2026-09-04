'use client'

import { useEffect, useMemo, useState } from 'react'
import Modal from '@/components/ui/Modal'
import {
  Globe,
  Key,
  User,
  AlertCircle,
  ExternalLink,
  CheckCircle2,
  Loader2,
  Eye,
  EyeOff,
} from 'lucide-react'
import toast from 'react-hot-toast'
import type { Site } from '@/types'

interface EditCredentialsModalProps {
  open: boolean
  site: Site | null
  onClose: () => void
  onSaved: () => void
}

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'passed'; message?: string }
  | { status: 'failed'; error: string }

function maskSecret(secret: string | undefined | null): string {
  if (!secret) return '—'
  const trimmed = secret.trim()
  if (!trimmed) return '—'
  if (trimmed.length <= 4) return '•'.repeat(trimmed.length)
  return `${'•'.repeat(Math.max(trimmed.length - 4, 4))}${trimmed.slice(-4)}`
}

export default function EditCredentialsModal({
  open,
  site,
  onClose,
  onSaved,
}: EditCredentialsModalProps) {
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [nodeApiUrl, setNodeApiUrl] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!site || !open) return
    setUrl(site.url ?? '')
    setUsername(site.wp_username ?? '')
    setAppPassword('')
    setNodeApiUrl(site.node_api_url ?? site.url ?? '')
    setShowPassword(false)
    setTest({ status: 'idle' })
    setError('')
    setSaving(false)
  }, [site, open])

  const isWordPress = site?.site_type === 'wordpress'
  const isNode = site?.site_type === 'nodejs'
  const isOther = site?.site_type === 'other'
  // 'other' sites take the WP credential form so the user can promote them.
  const usesWpForm = isWordPress || isOther

  const formSignature = useMemo(() => {
    if (usesWpForm) return `wp|${url.trim()}|${username.trim()}|${appPassword.trim()}`
    if (isNode) return `node|${nodeApiUrl.trim()}`
    return ''
  }, [usesWpForm, isNode, url, username, appPassword, nodeApiUrl])

  useEffect(() => {
    setTest((prev) => (prev.status === 'idle' ? prev : { status: 'idle' }))
  }, [formSignature])

  if (!site) return null

  function validateUrl(raw: string) {
    try {
      const u = new URL(raw.trim())
      return u.protocol === 'https:' || u.protocol === 'http:'
    } catch {
      return false
    }
  }

  function validate(): string | null {
    if (usesWpForm) {
      if (!url.trim() || !validateUrl(url)) return 'Enter a valid WordPress URL (include https://)'
      if (!username.trim()) return 'Enter your WordPress username'
      if (!appPassword.trim()) return 'Enter a new application password to test'
      return null
    }
    if (isNode) {
      if (!nodeApiUrl.trim() || !validateUrl(nodeApiUrl)) return 'Enter a valid site URL (include https://)'
      return null
    }
    return null
  }

  async function handleTest() {
    if (!site) return
    setError('')
    const v = validate()
    if (v) {
      setError(v)
      return
    }

    const payload: Record<string, string> = {}
    if (usesWpForm) {
      payload.url = url.trim()
      payload.wp_username = username.trim()
      payload.wp_app_password = appPassword.trim()
    } else if (isNode) {
      payload.node_api_url = nodeApiUrl.trim()
    }

    setTest({ status: 'testing' })
    try {
      const res = await fetch(`/api/sites/${site.id}/test-credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success) {
        setTest({ status: 'passed', message: data.siteName })
      } else {
        setTest({ status: 'failed', error: data.error || 'Connection failed' })
      }
    } catch {
      setTest({ status: 'failed', error: 'Network error — please try again' })
    }
  }

  async function handleSave() {
    if (!site || test.status !== 'passed') return
    setError('')

    const payload: Record<string, string> = {}
    if (usesWpForm) {
      payload.url = url.trim()
      payload.wp_username = username.trim()
      payload.wp_app_password = appPassword.trim()
    } else if (isNode) {
      payload.node_api_url = nodeApiUrl.trim()
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/sites/${site.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Failed to save credentials')
        setTest({ status: 'failed', error: data.error || 'Save failed' })
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

  const modalTitle = isOther
    ? `Add WordPress credentials — ${site.name}`
    : `Edit credentials — ${site.name}`

  return (
    <Modal open={open} onClose={onClose} title={modalTitle}>
      <div className="space-y-4">
        {error && (
          <div className="flex items-start gap-2.5 p-3.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {usesWpForm && (
          <>
            {isOther ? (
              <div className="flex items-start gap-2.5 p-3.5 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-700">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                This is an analytics-only site. Adding WordPress credentials will let
                you publish articles here.
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-3.5 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Current credentials
                </p>
                <div className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                  <User className="w-4 h-4 text-gray-400" />
                  <span className="font-mono">{site.wp_username || '—'}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                  <Key className="w-4 h-4 text-gray-400" />
                  <span className="font-mono tracking-wider">{maskSecret(site.wp_app_password)}</span>
                </div>
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
                className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                <User className="w-4 h-4 inline-block mr-1 text-gray-400" />
                {isOther ? 'WordPress username' : 'New WordPress username'}
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
                  {isOther ? 'Application password' : 'New application password'}
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const clean = url.replace(/\/$/, '')
                    if (!clean) {
                      toast.error('Enter your WordPress URL first')
                      return
                    }
                    window.open(
                      `${clean}/wp-admin/profile.php#application-passwords-section`,
                      '_blank'
                    )
                  }}
                  className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium hover:underline transition-colors"
                >
                  Generate in WordPress
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={appPassword}
                  onChange={(e) => setAppPassword(e.target.value)}
                  placeholder="xxxx xxxx xxxx xxxx"
                  className="w-full px-4 py-2.5 pr-11 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </>
        )}

        {isNode && (
          <>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-3.5 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Current credentials
              </p>
              <div className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                <Globe className="w-4 h-4 text-gray-400" />
                <span className="font-mono break-all">{site.node_api_url || site.url || '—'}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
                <Key className="w-4 h-4 text-gray-400" />
                <span className="font-mono tracking-wider">{maskSecret(site.secret_token)}</span>
              </div>
            </div>

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
          </>
        )}

        {test.status === 'passed' && (
          <div className="flex items-start gap-2.5 p-3.5 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              Connection verified{test.message ? ` — ${test.message}` : ''}. You can now save.
            </span>
          </div>
        )}
        {test.status === 'failed' && (
          <div className="flex items-start gap-2.5 p-3.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {test.error}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleTest}
            disabled={test.status === 'testing' || saving}
            className="flex-1 flex items-center justify-center gap-2 border border-brand-600 text-brand-700 dark:text-brand-400 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-50 dark:hover:bg-brand-900/20 transition-colors disabled:opacity-50"
          >
            {test.status === 'testing' && <Loader2 className="w-4 h-4 animate-spin" />}
            {test.status === 'testing' ? 'Testing…' : 'Test connection'}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={test.status !== 'passed' || saving}
            title={test.status !== 'passed' ? 'Test the connection first' : 'Save credentials'}
            className="flex-1 flex items-center justify-center gap-2 bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
