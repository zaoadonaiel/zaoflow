'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import SEOPageBuilder from '@/components/seo-pages/SEOPageBuilder'
import type { SEOPage } from '@/types'

export default function EditSEOPagePage() {
  const params = useParams<{ id: string }>()
  const [seoPage, setSeoPage] = useState<SEOPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!params?.id) return
    setLoading(true)
    fetch(`/api/seo-pages/${params.id}`)
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || 'Not found')
        return data.seoPage as SEOPage
      })
      .then((p) => setSeoPage(p))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [params?.id])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    )
  }

  if (error || !seoPage) {
    return (
      <div className="max-w-md mx-auto py-24 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">{error || 'SEO page not found'}</p>
      </div>
    )
  }

  return <SEOPageBuilder initial={seoPage} />
}
