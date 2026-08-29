'use client'

import { useState, useEffect } from 'react'
import { Key, Eye, EyeOff, Save, Loader2, CheckCircle2, User, Sparkles } from 'lucide-react'
import Header from '@/components/layout/Header'
import ModelSelect from '@/components/ui/ModelSelect'
import { AVAILABLE_MODELS } from '@/lib/openrouter'
import toast from 'react-hot-toast'

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [defaultModel, setDefaultModel] = useState(AVAILABLE_MODELS[0].id)
  const [fullName, setFullName] = useState('')
  const [savingApi, setSavingApi] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((data) => {
      if (data.settings) {
        setApiKey(data.settings.openrouter_api_key || '')
        setDefaultModel(data.settings.default_model || AVAILABLE_MODELS[0].id)
      }
      if (data.profile) {
        setFullName(data.profile.full_name || '')
      }
      setLoading(false)
    })
  }, [])

  async function saveApiSettings() {
    setSavingApi(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openrouter_api_key: apiKey, default_model: defaultModel }),
      })
      if (!res.ok) throw new Error()
      toast.success('API settings saved')
    } catch {
      toast.error('Failed to save')
    } finally {
      setSavingApi(false)
    }
  }

  async function saveProfile() {
    setSavingProfile(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: fullName }),
      })
      if (!res.ok) throw new Error()
      toast.success('Profile updated')
    } catch {
      toast.error('Failed to update profile')
    } finally {
      setSavingProfile(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 text-brand-600 animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <Header title="Settings" subtitle="Manage your account and API configuration" />

      <div className="space-y-6">
        {/* OpenRouter API */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 bg-brand-50 dark:bg-brand-900/30 rounded-xl flex items-center justify-center">
              <Key className="w-5 h-5 text-brand-600 dark:text-brand-400" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-white">OpenRouter API</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Required for AI content generation</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">API Key</label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-or-v1-..."
                  className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-mono text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
                Get your key at{' '}
                <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-brand-600 dark:text-brand-400 hover:underline">
                  openrouter.ai/keys
                </a>
              </p>
            </div>


            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-gray-400" />
                Default AI Model
              </label>
              <ModelSelect
                value={defaultModel}
                onChange={setDefaultModel}
              />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">Used when no model is selected per article</p>
            </div>

            <button
              onClick={saveApiSettings}
              disabled={savingApi}
              className="flex items-center gap-2 bg-brand-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
            >
              {savingApi ? <Loader2 className="w-4 h-4 spin" /> : <Save className="w-4 h-4" />}
              Save API settings
            </button>
          </div>
        </div>

        {/* Profile */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 bg-gray-100 dark:bg-gray-700 rounded-xl flex items-center justify-center">
              <User className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-white">Profile</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Your account details</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Full name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your name"
                className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <button
              onClick={saveProfile}
              disabled={savingProfile}
              className="flex items-center gap-2 bg-gray-900 dark:bg-gray-700 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
            >
              {savingProfile ? <Loader2 className="w-4 h-4 spin" /> : <Save className="w-4 h-4" />}
              Update profile
            </button>
          </div>
        </div>

        {/* WordPress Plugin info */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-2">WordPress Plugin</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            The Zao Flo Connector plugin extends WordPress publishing with status callbacks and advanced scheduling.
            Basic publishing works without it via the WordPress REST API.
          </p>
          <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4 font-mono text-xs text-gray-600 dark:text-gray-400 mb-4 overflow-x-auto">
            <p># Install the plugin on your WordPress site</p>
            <p># Upload zaoflo-connector.zip via Plugins → Add New → Upload</p>
            <p># Or place the folder in /wp-content/plugins/zaoflo-connector/</p>
          </div>
          <a
            href="#"
            className="inline-flex items-center gap-2 bg-gray-900 dark:bg-gray-700 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-600 transition-colors"
          >
            <CheckCircle2 className="w-4 h-4" />
            Download Plugin (zaoflo-connector.zip)
          </a>
        </div>
      </div>
    </div>
  )
}
