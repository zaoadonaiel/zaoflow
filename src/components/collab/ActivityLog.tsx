'use client'

import { History } from 'lucide-react'
import { format } from 'date-fns'
import {
  EVENT_VERB, type CollabEvent, type AuthorSide, type EventKind,
} from '@/lib/collab'

interface Props {
  events: CollabEvent[]
  /** Which side is reading, so their own entries can be marked as theirs. */
  mySide: AuthorSide
  className?: string
}

/**
 * Everything that has happened to an article, both sides in one column.
 *
 * One list rather than two: the point is that neither side has to take the
 * other's word for what went on. A comment, a pause, an edit and a new draft
 * are all the same kind of fact here, and they are shown newest first because
 * the question being asked of a log is almost always "what just happened".
 */
export default function ActivityLog({ events, mySide, className = '' }: Props) {
  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 ${className}`}
    >
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <History className="w-4 h-4 text-gray-400" />
        Activity
      </h2>

      {events.length === 0 ? (
        <p className="text-xs text-gray-400">Nothing yet.</p>
      ) : (
        <ol className="space-y-3">
          {events.map((e) => {
            const mine = e.side === mySide
            return (
              <li key={e.id} className="flex gap-2.5">
                {/* The dot carries the side, so the column scans as two
                    voices without every line having to say whose it is. */}
                <span
                  aria-hidden
                  className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    mine ? 'bg-brand-500' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                />
                <div className="min-w-0">
                  <p className="text-xs text-gray-700 dark:text-gray-300 leading-snug">
                    <span className="font-medium text-gray-900 dark:text-white">
                      {e.actor || (mine ? 'You' : 'Someone')}
                    </span>{' '}
                    {EVENT_VERB[e.kind as EventKind] || 'did something'}
                  </p>
                  {e.detail && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 break-words">
                      {e.detail}
                    </p>
                  )}
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {format(new Date(e.created_at), 'MMM d, h:mm a')}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
