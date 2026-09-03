'use client'

import { useState } from 'react'
import { Play, Pause, Loader2 } from 'lucide-react'

interface Props {
  paused: boolean
  /** False once published: the state is history, not a decision any more. */
  canChange: boolean
  /** Icon-only, small enough to sit on a card in the list. */
  compact?: boolean
  onChange: (paused: boolean) => Promise<void>
}

/**
 * Approve / pause, as two states of one control.
 *
 * Approved is the resting state and is drawn as such: doing nothing is what
 * most articles need, and the schedule carries them out. Pause is the
 * deliberate one -- and it does not expire. An article left paused and
 * forgotten stays unpublished, which is the whole reason the control exists;
 * a pause that quietly lapsed would be worse than no pause at all.
 *
 * So the two states are told apart by colour, not just by which half is
 * shaded: approved is green, paused is red, and whichever side is not in
 * force goes grey. Grey-on-grey would leave a paused article looking like an
 * approved one, which is the one mistake this control cannot afford.
 */
export default function ApprovalToggle({ paused, canChange, compact = false, onChange }: Props) {
  const [busy, setBusy] = useState(false)

  async function set(next: boolean) {
    if (busy || next === paused || !canChange) return
    setBusy(true)
    try {
      await onChange(next)
    } finally {
      setBusy(false)
    }
  }

  // Only the chosen side lights up. Both drawn at full size either way, so the
  // control does not shift as it changes.
  const base = compact
    ? 'flex items-center justify-center w-8 h-8 rounded-lg transition-colors disabled:cursor-default'
    : 'flex flex-col items-center gap-1 px-5 py-2.5 rounded-xl transition-colors disabled:cursor-default'

  const idle = 'text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'
  const icon = compact ? 'w-4 h-4' : 'w-5 h-5'

  return (
    <div
      role="group"
      aria-label="Publishing"
      className={`inline-flex items-center gap-1 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 ${
        compact ? 'rounded-xl p-0.5' : 'rounded-2xl p-1'
      }`}
    >
      <button
        type="button"
        onClick={() => set(false)}
        disabled={!canChange || busy}
        aria-pressed={!paused}
        aria-label={compact ? 'Approve for publishing' : undefined}
        title={compact ? 'Approved — publishes on schedule' : undefined}
        className={`${base} ${
          paused ? idle : 'approve-live bg-green-50/60 dark:bg-green-500/10'
        }`}
      >
        {busy && paused ? (
          <Loader2 className={`${icon} animate-spin`} />
        ) : (
          <Play className={icon} fill="currentColor" />
        )}
        {!compact && <span className="text-xs font-semibold">Approved</span>}
      </button>

      <button
        type="button"
        onClick={() => set(true)}
        disabled={!canChange || busy}
        aria-pressed={paused}
        aria-label={compact ? 'Pause publishing' : undefined}
        title={compact ? 'Paused — will not publish' : undefined}
        className={`${base} ${
          paused ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/15' : idle
        }`}
      >
        {busy && !paused ? (
          <Loader2 className={`${icon} animate-spin`} />
        ) : (
          <Pause className={icon} fill="currentColor" />
        )}
        {!compact && <span className="text-xs font-semibold">Paused…</span>}
      </button>
    </div>
  )
}
