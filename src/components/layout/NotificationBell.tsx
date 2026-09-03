'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, MessageSquare, Loader2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import type { ArticleComment } from '@/types'

/**
 * Open client comments, Facebook-style. Clicking one opens that article so the
 * change can be made and marked done.
 */
export default function NotificationBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [comments, setComments] = useState<ArticleComment[]>([])
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/comments?open=true')
      const data = await res.json()
      if (res.ok) setComments(data.comments || [])
    } catch {
      // A failed poll should never surface as an error in the header.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    // Cheap polling: the dashboard is a long-lived tab and a client comment is
    // not urgent enough to justify a realtime subscription.
    const id = setInterval(load, 60000)
    return () => clearInterval(id)
  }, [load])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const count = comments.length

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen((o) => !o); if (!open) load() }}
        className="relative w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
        aria-label={`${count} article${count === 1 ? '' : 's'} need attention`}
      >
        <Bell className="w-5 h-5" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-lg z-50">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Needs attention</p>
          </div>

          {loading && !comments.length ? (
            <div className="py-8 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-gray-400" /></div>
          ) : !count ? (
            <div className="py-10 text-center px-4">
              <MessageSquare className="w-6 h-6 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">Nothing waiting on you.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {comments.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setOpen(false)
                    router.push(`/articles/${c.article_id}#comments`)
                  }}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/40"
                >
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {c.articles?.title || 'Article'}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-0.5">{c.body}</p>
                  <p className="text-[11px] text-gray-400 mt-1">
                    {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                    {c.is_billable && <span className="text-amber-500 ml-1.5">· billable</span>}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
