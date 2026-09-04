'use client'

import { useParams } from 'next/navigation'
import ArticleForm from '@/components/articles/ArticleForm'

export default function ArticleDetailPage() {
  const { id } = useParams<{ id: string }>()
  return <ArticleForm articleId={id} />
}
