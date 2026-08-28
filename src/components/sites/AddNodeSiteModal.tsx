'use client'

import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import { Globe, Server, Key, CheckCircle2, AlertCircle, Loader2, Copy, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import type { Site } from '@/types'

interface AddNodeSiteModalProps {
  open: boolean
  onClose: () => void
  onAdded: () => void
}

type Step = 'form' | 'created' | 'testing' | 'success'

export default function AddNodeSiteModal({ open, onClose, onAdded }: AddNodeSiteModalProps) {
  const [step, setStep] = useState<Step>('form')
  const [name, setName] = useState('')
  const [apiUrl, setApiUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState('')
  const [testError, setTestError] = useState('')
  const [site, setSite] = useState<Site | null>(null)
  const [copied, setCopied] = useState(false)

  function reset() {
    setStep('form')
    setName('')
    setApiUrl('')
    setLoading(false)
    setFormError('')
    setTestError('')
    setSite(null)
    setCopied(false)
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { toast.error('Enter a site name'); return }
    if (!apiUrl.trim()) { toast.error('Enter your Node.js site URL'); return }
    if (!validateUrl(apiUrl)) { toast.error('Enter a valid URL (include https://)'); return }

    setLoading(true)
    setFormError('')

    try {
      const res = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_type: 'nodejs', name, node_api_url: apiUrl }),
      })

      const data = await res.json()

      if (!res.ok && !data.site) {
        setFormError(data.error || 'Failed to add site')
        return
      }

      setSite(data.site)
      setStep('created')
      if (data.site?.status === 'connected') {
        toast.success(`${data.site.name} connected successfully!`)
      }
      onAdded()
    } catch {
      setFormError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  async function handleTest() {
    if (!site) return
    setStep('testing')
    setTestError('')
    try {
      const res = await fetch(`/api/sites/${site.id}/test`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setStep('success')
        toast.success('Connection verified!')
        onAdded()
      } else {
        setTestError(data.error || 'Could not connect — check that your Node.js site is deployed with the API key set.')
        setStep('created')
      }
    } catch {
      setTestError('Network error — please try again')
      setStep('created')
    }
  }

  async function copySecret() {
    if (!site) return
    try {
      await navigator.clipboard.writeText(site.secret_token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy — select and copy manually')
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Connect Node.js Site">
      {step === 'form' && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="flex items-start gap-2.5 p-3.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {formError}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Site name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Node.js Blog"
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              <Globe className="w-4 h-4 inline-block mr-1 text-gray-400" />
              Node.js site URL
            </label>
            <input
              type="url"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="https://yoursite.com"
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>

          <div className="p-3.5 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700 space-y-1.5">
            <p className="font-medium text-blue-800">How it works</p>
            <ol className="list-decimal list-inside space-y-0.5 ml-1">
              <li>Zao Flo creates the site and gives you an API key</li>
              <li>Add the key to your Node.js site&apos;s environment and deploy the <code className="font-mono">/api/zaoflo/*</code> routes</li>
              <li>Come back and test the connection</li>
            </ol>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create site'}
            </button>
          </div>
        </form>
      )}

      {step === 'created' && site && (
        <div className="space-y-4">
          {testError && (
            <div className="flex items-start gap-2.5 p-3.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {testError}
            </div>
          )}

          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <div className="w-12 h-12 bg-brand-50 rounded-full flex items-center justify-center">
              <Server className="w-6 h-6 text-brand-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">{site.name} created</p>
              <p className="text-sm text-gray-500 mt-1">Add the API key below to your site, then test the connection.</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              <Key className="w-4 h-4 inline-block mr-1 text-gray-400" />
              API key
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-mono text-gray-800 break-all">
                {site.secret_token}
              </code>
              <button
                type="button"
                onClick={copySecret}
                title="Copy"
                className="flex-shrink-0 w-10 h-10 flex items-center justify-center border border-gray-200 rounded-xl text-gray-500 hover:bg-gray-50 transition-colors"
              >
                {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="p-3.5 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700">
            Add this as <code className="font-mono font-semibold">ZAOFLO_API_KEY</code> in your Node.js site&apos;s
            environment variables, deploy your <code className="font-mono">/api/zaoflo/*</code> routes, then click
            Test connection below.
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Do this later
            </button>
            <button
              type="button"
              onClick={handleTest}
              className="flex-1 bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
            >
              Test connection
            </button>
          </div>
        </div>
      )}

      {step === 'testing' && (
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="w-12 h-12 bg-brand-50 rounded-full flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-brand-600 animate-spin" />
          </div>
          <div className="text-center">
            <p className="font-medium text-gray-900">Testing connection...</p>
            <p className="text-sm text-gray-500 mt-1">Calling your site&apos;s health endpoint</p>
          </div>
        </div>
      )}

      {step === 'success' && (
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6 text-green-600" />
          </div>
          <div className="text-center">
            <p className="font-semibold text-gray-900">Site connected!</p>
            <p className="text-sm text-gray-500 mt-1">{name} is ready for publishing.</p>
          </div>
          <button
            onClick={handleClose}
            className="mt-2 bg-brand-600 text-white px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            Done
          </button>
        </div>
      )}
    </Modal>
  )
}
