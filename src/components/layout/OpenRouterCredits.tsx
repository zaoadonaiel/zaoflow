'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Wallet, RefreshCw, AlertCircle } from 'lucide-react'

interface Credits {
  usage: number
  limit: number | null
  balance: number | null
}

// Refresh cadence: rare enough not to spam OpenRouter from every open tab,
// often enough that a top-up made in another tab is reflected within a minute.
const POLL_MS = 60_000

function formatDollars(v: number): string {
  if (v >= 1000) return `$${v.toFixed(0)}`
  if (v >= 10) return `$${v.toFixed(1)}`
  return `$${v.toFixed(2)}`
}

export default function OpenRouterCredits() {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ok'; credits: Credits }
    | { kind: 'missing' }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' })
  const [refreshing, setRefreshing] = useState(false)

  async function load(manual = false) {
    if (manual) setRefreshing(true)
    try {
      const res = await fetch('/api/openrouter/credits', { cache: 'no-store' })
      if (res.status === 404) {
        setState({ kind: 'missing' })
        return
      }
      const data = await res.json()
      if (!res.ok) {
        setState({ kind: 'error', message: data?.error || `HTTP ${res.status}` })
        return
      }
      setState({ kind: 'ok', credits: data })
    } catch {
      setState({ kind: 'error', message: 'Network error' })
    } finally {
      if (manual) setRefreshing(false)
    }
  }

  useEffect(() => {
    load()
    const t = setInterval(() => load(), POLL_MS)
    return () => clearInterval(t)
  }, [])

  if (state.kind === 'missing') {
    return (
      <Link
        href="/settings"
        className="mx-3 mt-3 flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/10 text-xs text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
        title="Add your OpenRouter API key in Settings"
      >
        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="flex-1 truncate">Add OpenRouter key</span>
      </Link>
    )
  }

  const balance = state.kind === 'ok' ? state.credits.balance : null
  const usage = state.kind === 'ok' ? state.credits.usage : null
  const limit = state.kind === 'ok' ? state.credits.limit : null
  const low = balance !== null && balance < 1

  return (
    <div
      className={`mx-3 mt-3 flex items-center gap-2 px-3 py-2 rounded-xl border transition-colors ${
        low
          ? 'border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/15'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
      }`}
      title={
        state.kind === 'ok'
          ? limit == null
            ? `Uncapped key — $${usage!.toFixed(2)} used`
            : `$${usage!.toFixed(2)} used of $${limit.toFixed(2)}`
          : 'OpenRouter balance'
      }
    >
      <Wallet
        className={`w-4 h-4 flex-shrink-0 ${
          low ? 'text-red-500' : 'text-brand-600 dark:text-brand-400'
        }`}
      />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wide font-medium text-gray-400 dark:text-gray-500 leading-tight">
          OpenRouter
        </div>
        <div
          className={`text-sm font-semibold leading-tight truncate ${
            low ? 'text-red-700 dark:text-red-400' : 'text-gray-900 dark:text-white'
          }`}
        >
          {state.kind === 'loading' && '···'}
          {state.kind === 'error' && '—'}
          {state.kind === 'ok' && balance !== null && formatDollars(balance)}
          {state.kind === 'ok' && balance === null && `${formatDollars(usage!)} used`}
        </div>
      </div>
      <button
        type="button"
        onClick={() => load(true)}
        aria-label="Refresh OpenRouter balance"
        title="Refresh"
        className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors p-1 rounded flex-shrink-0"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
      </button>
    </div>
  )
}
