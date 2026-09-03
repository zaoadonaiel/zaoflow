'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { FileText, Globe, Plus } from 'lucide-react'

/**
 * The plus at the top of every page: the two things there are to make.
 *
 * A page's own header button only ever offers the one thing that page is
 * about, so starting a site from the articles list meant going to Sites first.
 * This is the same plus everywhere, and it does not care which page you are on.
 */
export default function NewMenu() {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  // Anywhere else, and Escape, closes it — a menu that only closes by picking
  // something from it is a trap.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={wrap}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Make something new"
        aria-label="Make something new"
        className="w-10 h-10 flex items-center justify-center rounded-xl bg-brand-600 text-white hover:bg-brand-700 transition-colors"
      >
        <Plus className="w-4 h-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-48 z-40 rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg p-1"
        >
          <Link
            href="/articles/new"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <FileText className="w-4 h-4 text-gray-400" />
            New article
          </Link>
          {/* The add-site form lives on the Sites page, so the menu asks that
              page to open it rather than keeping a second copy of it here. */}
          <Link
            href="/sites?new=1"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <Globe className="w-4 h-4 text-gray-400" />
            New site
          </Link>
        </div>
      )}
    </div>
  )
}
