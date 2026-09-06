'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  // ReactNode rather than string so callers (e.g. ScheduleCalendarModal) can
  // slot controls into the header row next to the title.
  title: React.ReactNode
  children: React.ReactNode
  maxWidth?: string
  /**
   * Replaces the default close (X) button in the header row when provided —
   * for modals that carry their own primary/cancel actions up top rather than
   * a lone dismiss control.
   */
  headerRight?: React.ReactNode
}

export default function Modal({ open, onClose, title, children, maxWidth = 'max-w-lg', headerRight }: ModalProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (open) document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      <div
        className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={`relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 w-full ${maxWidth} animate-fade-in max-h-[92vh] sm:max-h-[90vh] overflow-y-auto`}
      >
        <div className="flex flex-wrap items-center justify-between gap-y-2 gap-x-3 px-4 py-3 sm:px-6 sm:py-5 border-b border-gray-100 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800 rounded-t-2xl z-30">
          {/* flex container so multi-piece titles (icon buttons, meta
              readouts) can align and wrap on narrow screens. */}
          <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2 flex-wrap min-w-0">{title}</h2>
          {headerRight ? (
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">{headerRight}</div>
          ) : (
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="px-4 py-4 sm:px-6 sm:py-5">{children}</div>
      </div>
    </div>
  )
}
