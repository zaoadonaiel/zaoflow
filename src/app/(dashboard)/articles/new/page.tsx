'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import ArticleForm from '@/components/articles/ArticleForm'

export default function NewArticlePage() {
  return (
    <Suspense fallback={null}>
      <NewOrRedirect />
    </Suspense>
  )
}

/**
 * `/articles/new?id=<uuid>` used to be the only full editor. That form now
 * lives at `/articles/<uuid>`, so old links (bookmarks, notifications sent
 * before this change) are forwarded there instead of opening a second editor.
 */
function NewOrRedirect() {
  const router = useRouter()
  const params = useSearchParams()
  const editId = params.get('id')
  // Archive -> Ideas sends a turned-down idea back here to be written up.
  const ideaId = params.get('idea')

  useEffect(() => {
    if (editId) router.replace(`/articles/${editId}`)
  }, [editId, router])

  if (editId) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  return <ArticleForm ideaId={ideaId} />
}
