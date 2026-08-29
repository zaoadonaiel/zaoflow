'use client'

import { useState } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'

/**
 * The access-code check shown before the articles.
 *
 * The code is not on this page and never reaches the browser: it is generated
 * in the dashboard, given to the client separately from the link, and checked
 * on the server. Getting it right is what unlocks the portal's data, so a link
 * forwarded to somebody else opens nothing on its own.
 */
export default function PortalGate({
  token,
  onPass,
}: {
  token: string
  onPass: () => void
}) {
  const [entry, setEntry] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  // Three misses and the link is shut until the team issues a new code. The
  // form closes rather than sitting there taking guesses it will never accept.
  const [lockedOut, setLockedOut] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (entry.length !== 5 || checking || lockedOut) return

    setChecking(true)
    try {
      const res = await fetch(`/api/portal/${token}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: entry }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'That code is not right.')
        setEntry('')
        if (data.needs_new_code) setLockedOut(true)
        return
      }
      onPass()
    } catch {
      setError('That could not be checked. Please try again.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50 dark:bg-gray-900">
      <div className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm p-8 text-center">
        <div className="w-11 h-11 rounded-full bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center mx-auto mb-5">
          <ShieldCheck className="w-5 h-5 text-brand-600" />
        </div>

        <p className="font-medium text-gray-900 dark:text-white">
          {lockedOut ? 'This link is locked' : 'Enter your access code'}
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-5">
          {lockedOut
            ? 'Your account manager can issue you a new code.'
            : 'Your account manager gave you a 5-digit code for this link. You have three tries.'}
        </p>

        {lockedOut ? (
          <p className="text-sm text-red-500">{error}</p>
        ) : (
          <form onSubmit={submit}>
            <input
              value={entry}
              onChange={(e) => { setEntry(e.target.value.replace(/\D/g, '').slice(0, 5)); setError(null) }}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              aria-label="Access code"
              placeholder="•••••"
              className={`w-full h-12 text-center text-xl tracking-[0.3em] rounded-xl border bg-white dark:bg-gray-900 text-gray-900 dark:text-white ${
                error ? 'border-red-400' : 'border-gray-200 dark:border-gray-700'
              }`}
            />
            {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
            <button
              type="submit"
              disabled={entry.length !== 5 || checking}
              className="w-full h-12 mt-4 rounded-xl bg-brand-600 text-white font-semibold hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
            >
              {checking && <Loader2 className="w-4 h-4 animate-spin" />}
              Access
            </button>
          </form>
        )}

        <p className="text-xs text-gray-400 mt-5">
          Don&apos;t have a code? Ask your account manager for one.
        </p>
      </div>
    </div>
  )
}
