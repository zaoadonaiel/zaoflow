import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * "Done" — the team has made the change the client asked for. Stamping
 * resolved_at is what flips the article's badge to Revision Complete.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  // Allow undoing a premature Done.
  const resolvedAt = body?.undo ? null : new Date().toISOString()

  const { data: comment, error } = await supabase
    .from('article_comments')
    .update({ resolved_at: resolvedAt })
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ comment })
}
