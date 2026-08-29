'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  /** A node, not just a string, so a header can carry a control beside its name. */
  title: React.ReactNode
  /**
   * What sits at the far end of the title bar, before the close button.
   *
   * A modal whose confirm button is at the foot of a long scrolling body makes
   * you scroll past everything to commit — so the ones that scroll put their
   * readout and their buttons up here instead, where they stay in view.
   */
  headerRight?: React.ReactNode
  children: React.ReactNode
  maxWidth?: string
}

export default function Modal({ open, onClose, title, children, headerRight, maxWidth = 'max-w-lg' }: ModalProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (open) document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={`relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 w-full ${maxWidth} animate-fade-in max-h-[90vh] overflow-y-auto`}
      >
        {/* An untitled modal still needs its close button, but not the empty
            band and rule a title would have sat on.

            The bar is tinted rather than the same white as the body: sitting
            over content that scrolls under it, a header the exact colour of
            what it covers reads as nothing being there at all. Shallow with
            it — a title bar is a label, and every row it steals is a row of
            the calendar underneath. */}
        <div
          className={`flex items-center justify-between gap-3 px-6 sticky top-0 z-10 rounded-t-2xl ${
            title
              ? 'py-3 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700'
              : 'pt-4 bg-white dark:bg-gray-800'
          }`}
        >
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2 min-w-0">
            {title}
          </h2>
          {headerRight && (
            <div className="flex items-center gap-2 flex-shrink-0 ml-auto">{headerRight}</div>
          )}
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  )
}
