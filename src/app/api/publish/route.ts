import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { publishArticle } from '@/lib/publish-article'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { articleId, scheduledAt, scheduledTz } = await req.json()
  if (!articleId) return NextResponse.json({ error: 'articleId is required' }, { status: 400 })

  const result = await publishArticle({
    supabase,
    userId: user.id,
    articleId,
    scheduledAt,
    scheduledTz,
  })

  if (!result.success) {
    // Somebody is watching this one, so a failure is a failure — it belongs on
    // screen and in the row, not quietly back in a queue.
    await supabase.from('articles').update({
      status: 'failed',
      updated_at: new Date().toISOString(),
    }).eq('id', articleId).eq('user_id', user.id)

    return NextResponse.json({ error: result.error || 'Publish failed' }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    id: result.wpPostId ?? result.nodePostId,
    url: result.wpPostUrl ?? result.nodePostUrl,
    imageWarning: result.imageWarning,
    categoryWarning: result.categoryWarning,
  })
}
