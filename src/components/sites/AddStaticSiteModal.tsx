'use client'

import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import {
  Globe,
  Github,
  Key,
  FileJson,
  Languages,
  GitBranch,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
} from 'lucide-react'
import toast from 'react-hot-toast'

interface AddStaticSiteModalProps {
  open: boolean
  onClose: () => void
  onAdded: () => void
}

type Step = 'form' | 'testing' | 'success'

export default function AddStaticSiteModal({ open, onClose, onAdded }: AddStaticSiteModalProps) {
  const [step, setStep] = useState<Step>('form')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [repo, setRepo] = useState('')
  const [token, setToken] = useState('')
  const [branch, setBranch] = useState('main')
  const [contentPath, setContentPath] = useState('content/articles.json')
  const [language, setLanguage] = useState('en')
  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState('')

  function reset() {
    setStep('form')
    setName('')
    setUrl('')
    setRepo('')
    setToken('')
    setBranch('main')
    setContentPath('content/articles.json')
    setLanguage('en')
    setLoading(false)
    setFormError('')
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
    if (!url.trim()) { toast.error('Enter your public site URL'); return }
    if (!validateUrl(url)) { toast.error('Enter a valid URL (include https://)'); return }
    if (!repo.trim()) { toast.error('Enter the GitHub repo (owner/repo)'); return }
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo.trim())) {
      toast.error('Repo must look like "owner/repo" — not a full URL')
      return
    }
    if (!token.trim()) { toast.error('Paste your GitHub token'); return }

    setLoading(true)
    setFormError('')
    setStep('testing')

    try {
      const res = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site_type: 'static',
          name,
          url,
          github_repo: repo.trim(),
          github_token: token.trim(),
          github_branch: branch.trim() || 'main',
          github_content_path: contentPath.trim() || 'content/articles.json',
          github_default_language: language.trim() || 'en',
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setFormError(data.error || 'Failed to add site')
        setStep('form')
        return
      }

      setStep('success')
      toast.success(`${name} connected — pushes to ${repo}`)
      onAdded()
    } catch {
      setFormError('Network error — please try again')
      setStep('form')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Connect Static Site">
      {step === 'testing' && (
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="w-12 h-12 bg-brand-50 dark:bg-brand-500/10 rounded-full flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-brand-600 animate-spin" />
          </div>
          <div className="text-center">
            <p className="font-medium text-gray-900 dark:text-white">Reaching GitHub...</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Verifying token access to the repo</p>
          </div>
        </div>
      )}

      {step === 'success' && (
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="w-12 h-12 bg-green-50 dark:bg-green-500/10 rounded-full flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6 text-green-600" />
          </div>
          <div className="text-center">
            <p className="font-semibold text-gray-900 dark:text-white">Site connected!</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Published articles will commit to <code className="font-mono">{repo}</code> and trigger a rebuild.
            </p>
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
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="flex items-start gap-2.5 p-3.5 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl text-sm text-red-700 dark:text-red-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {formError}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Site name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Web Designer PR"
              className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              <Globe className="w-4 h-4 inline-block mr-1 text-gray-400" />
              Public site URL
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://webdesignerpr.com"
              className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              <Github className="w-4 h-4 inline-block mr-1 text-gray-400" />
              GitHub repo
            </label>
            <input
              type="text"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="owner/repo"
              className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent font-mono"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1">
                <Key className="w-4 h-4 text-gray-400" />
                GitHub token
              </label>
              <a
                href="https://github.com/settings/personal-access-tokens/new"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-medium hover:underline transition-colors"
              >
                Generate fine-grained PAT
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="github_pat_..."
              className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent font-mono"
            />
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              Give it <code className="font-mono">Contents: Read and write</code> on just this repo.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                <GitBranch className="w-4 h-4 inline-block mr-1 text-gray-400" />
                Branch
              </label>
              <input
                type="text"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="main"
                className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent font-mono"
              />
            </div>

            <div>
              <label htmlFor="static-site-language" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                <Languages className="w-4 h-4 inline-block mr-1 text-gray-400" />
                Content language
              </label>
              <select
                id="static-site-language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              >
                <option value="en">English</option>
                <option value="es">Español</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              <FileJson className="w-4 h-4 inline-block mr-1 text-gray-400" />
              Path to articles JSON
            </label>
            <input
              type="text"
              value={contentPath}
              onChange={(e) => setContentPath(e.target.value)}
              placeholder="content/articles.json"
              className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent font-mono"
            />
          </div>

          <div className="p-3.5 bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 rounded-xl text-xs text-blue-700 dark:text-blue-300 space-y-1.5">
            <p className="font-medium text-blue-800 dark:text-blue-200">How it works</p>
            <ol className="list-decimal list-inside space-y-0.5 ml-1">
              <li>Zao Flo commits published articles into <code className="font-mono">{contentPath || 'content/articles.json'}</code> on the <code className="font-mono">{branch || 'main'}</code> branch</li>
              <li>Cloudflare Pages / Netlify / Vercel sees the push and rebuilds automatically</li>
              <li>Same-slug re-publishes overwrite the existing entry — no duplicates</li>
            </ol>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
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
    </Modal>
  )
}
