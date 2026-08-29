'use client'

import { useParams } from 'next/navigation'
import ArticleForm from '@/components/articles/ArticleForm'

/**
 * Opening an article gives the same screen as writing one: the image
 * generator, the SEO fields, the AI instructions and the scheduler, all
 * loaded with what the article already has.
 */
export default function ArticleDetailPage() {
  const { id } = useParams<{ id: string }>()
  return <ArticleForm articleId={id} />
}
