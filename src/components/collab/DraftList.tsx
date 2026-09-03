'use client'

import { Layers } from 'lucide-react'
import { format } from 'date-fns'
import { draftLabel, EDIT_CLASS, type ArticleDraft, type AuthorSide } from '@/lib/collab'

interface Props {
  drafts: ArticleDraft[]
  /** The version being read, or null for the article as it stands now. */
  selectedId: string | null
  onSelect: (id: string | null) => void
  mySide: AuthorSide
  className?: string
}

/**
 * Every version of the article, oldest first.
 *
 * Nothing here can be removed. A draft is the record of what somebody wrote,
 * and the reason to keep it is precisely that the next person changed it --
 * a delete would let one side quietly erase the other's work, which is the
 * failure this whole feature exists to prevent. They are read-only for the
 * side that did not write them and re-editable by the side that did, but they
 * are never destroyed: editing one produces the next version, not a rewrite
 * of the old.
 */
export default function DraftList({
  drafts, selectedId, onSelect, mySide, className = '',
}: Props) {
  const row =
    'w-full text-left px-3 py-2.5 rounded-xl border transition-colors block'

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 ${className}`}
    >
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <Layers className="w-4 h-4 text-gray-400" />
        Versions
      </h2>

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`${row} ${
            selectedId === null
              ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-500/10'
              : 'border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900/40'
          }`}
        >
          <span className="text-xs font-semibold text-gray-900 dark:text-white">
            Current article
          </span>
          <span className="block text-[11px] text-gray-400 mt-0.5">
            What publishes on the schedule
          </span>
        </button>

        {drafts.length === 0 ? (
          <p className="text-xs text-gray-400 pt-1">
            No earlier versions yet — the first edit creates one.
          </p>
        ) : (
          drafts.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => onSelect(d.id)}
              className={`${row} ${
                selectedId === d.id
                  ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-500/10'
                  : 'border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900/40'
              }`}
            >
              <span
                className={`text-xs font-semibold ${EDIT_CLASS[d.author_side as AuthorSide] || ''}`}
              >
                {draftLabel(d)}
              </span>
              <span className="block text-[11px] text-gray-400 mt-0.5">
                {d.author_side === mySide ? 'Yours · ' : ''}
                {format(new Date(d.created_at), 'MMM d, h:mm a')}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
