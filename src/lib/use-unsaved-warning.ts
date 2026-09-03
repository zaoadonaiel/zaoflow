'use client'

import { useEffect } from 'react'

/**
 * Warns before unsaved work is thrown away.
 *
 * Covers both routes out: `beforeunload` catches tab close, refresh and
 * external navigation, while a capture-phase click handler catches in-app
 * links — the App Router gives no way to block a client-side navigation once
 * it has started, so it has to be intercepted before it does.
 */
export function useUnsavedWarning(active: boolean, message: string) {
  useEffect(() => {
    if (!active) return

    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }

    function onClick(e: MouseEvent) {
      // Let modified clicks through — they open a new tab and leave this one be.
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return

      const link = (e.target as HTMLElement | null)?.closest('a')
      if (!link) return

      const href = link.getAttribute('href')
      if (!href || href.startsWith('#') || link.target === '_blank') return
      // Only same-origin, and not a link back to where we already are.
      if (/^https?:\/\//i.test(href) && !href.startsWith(window.location.origin)) return
      if (href === window.location.pathname + window.location.search) return

      if (!window.confirm(message)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [active, message])
}
