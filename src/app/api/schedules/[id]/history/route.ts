import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: articles } = await supabase
    .from('articles')
    .select('id, title, status, wp_post_url, word_count, created_at')
    .eq('schedule_id', params.id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10)

  return NextResponse.json({ articles: articles || [] })
}
