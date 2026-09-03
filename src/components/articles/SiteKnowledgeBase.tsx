'use client'

import { useState } from 'react'
import { HardDrive, Eye, Pencil } from 'lucide-react'
import KnowledgeBaseModal from '@/components/sites/KnowledgeBaseModal'

const ICON_BUTTON =
  'flex items-center justify-center w-7 h-7 rounded-lg text-gray-400 dark:text-gray-500 ' +
  'hover:text-brand-600 dark:hover:text-brand-400 hover:bg-gray-100 dark:hover:bg-gray-700 ' +
  'transition-colors disabled:opacity-40 disabled:hover:text-gray-400 disabled:hover:bg-transparent'

interface Props {
  siteId: string
  siteName: string
  /** The site's stored text — only read here to say whether there is any. */
  knowledgeBase: string
  onSaved: (knowledgeBase: string) => void
}

/**
 * The selected site's knowledge base, sitting under the saved instructions:
 * the instructions say how to write, this says what the company is and what
 * the writing is about. The text itself lives in the modal — the eye opens it
 * to read, the pencil opens it at the same 5 digit code gate as the Sites
 * page. Nothing of it is spelled out here; it is pages long and this is a
 * sidebar.
 */
export default function SiteKnowledgeBase({ siteId, siteName, knowledgeBase, onSaved }: Props) {
  const [open, setOpen] = useState(false)
  const [startInEdit, setStartInEdit] = useState(false)
  const text = knowledgeBase.trim()

  function show(edit: boolean) {
    setStartInEdit(edit)
    setOpen(true)
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1 min-w-0">
          <HardDrive className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">
            Knowledge base
            {siteId && !text && (
              <span className="italic"> — nothing yet for {siteName}</span>
            )}
          </span>
        </span>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            type="button"
            onClick={() => show(false)}
            disabled={!siteId}
            title={siteId ? `Read ${siteName}'s knowledge base` : 'Pick a site first'}
            aria-label="View knowledge base"
            className={ICON_BUTTON}
          >
            <Eye className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => show(true)}
            disabled={!siteId}
            title={siteId ? `Edit ${siteName}'s knowledge base` : 'Pick a site first'}
            aria-label="Edit knowledge base"
            className={ICON_BUTTON}
          >
            <Pencil className="w-4 h-4" />
          </button>
        </div>
      </div>

      {open && (
        <KnowledgeBaseModal
          open
          onClose={() => setOpen(false)}
          siteId={siteId}
          siteName={siteName}
          startInEdit={startInEdit}
          onSaved={onSaved}
        />
      )}
    </>
  )
}
