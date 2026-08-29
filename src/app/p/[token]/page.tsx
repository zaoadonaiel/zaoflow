'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { Toaster } from 'react-hot-toast'
import PortalGate from '@/components/portal/PortalGate'
import PortalView, { type PortalArticle } from '@/components/portal/PortalView'

export default function PortalPage({ params }: { params: { token: string } }) {
  const [locked, setLocked] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [articles, setArticles] = useState<PortalArticle[]>([])
  const [meta, setMeta] = useState<{ client_name?: string | null; site_name?: string | null }>({})

  // True once articles have been on screen at least once. Everything below
  // hangs off this: the first load owns the page, later ones must not.
  const loadedOnce = useRef(false)

  /**
   * Refetches in place.
   *
   * Deliberately does NOT put the page back into its loading state. Reading an
   * article and sending a comment both refresh, and blanking the page for a
   * spinner unmounts the whole view — which threw the client back to the list
   * half a second after they opened an article, and again the instant they sent
   * a comment. The spinner belongs to the first load only.
   *
   * Whether the client is past the gate is the server's answer, not a flag this
   * page keeps: the pass is a signed http-only cookie, so the page finds out by
   * asking. A 401 means the code is needed — on arrival, or four hours in when
   * the pass quietly expired under an open tab.
   */
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/${params.token}`)
      const data = await res.json()

      if (res.status === 401 && data.code_required) {
        setLocked(true)
        setArticles([])
        loadedOnce.current = false
        return
      }
      if (!res.ok) throw new Error(data.error || 'This link is not valid.')

      setArticles(data.articles || [])
      setMeta(data.portal || {})
      setLocked(false)
      loadedOnce.current = true
      setError(null)
    } catch (err) {
      // A background refresh that fails must not replace what the client is
      // reading with an error page. Only speak up when there is nothing to keep.
      if (!loadedOnce.current) {
        setError(err instanceof Error ? err.message : 'This link is not valid.')
      }
    } finally {
      setLoading(false)
    }
  }, [params.token])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    )
  }

  if (locked) {
    return (
      <PortalGate
        token={params.token}
        onPass={() => {
          setLocked(false)
          setLoading(true)
          load()
        }}
      />
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50 dark:bg-gray-900">
        <div className="text-center max-w-sm">
          <p className="font-medium text-gray-900 dark:text-white">{error}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            Please check with your account manager for an up-to-date link.
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      <Toaster position="top-center" />
      <PortalView
        token={params.token}
        clientName={meta.client_name}
        siteName={meta.site_name}
        articles={articles}
        onRefresh={load}
      />
    </>
  )
}
