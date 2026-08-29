import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logEvent, teamName } from '@/lib/collab-server'
import { excerpt } from '@/lib/collab'

const MAX_BODY = 4000

/**
 * Comments for the dashboard: the notification bell asks for open ones, an
 * article page asks for its own thread.
 */
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const articleId = searchParams.get('article_id')
  const openOnly = searchParams.get('open') === 'true'

  let query = supabase
    .from('article_comments')
    .select('*, articles(id, title, site_id, sites(name))')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (articleId) query = query.eq('article_id', articleId)
  if (openOnly) query = query.is('resolved_at', null)

  const { data: comments, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ comments, open_count: comments?.length ?? 0 })
}

/**
 * The team's side of the thread.
 *
 * Lands in the same table as the client's notes so both sides read one
 * conversation rather than each keeping their own. Never billable: a reply is
 * not a revision request.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { article_id, body } = await req.json().catch(() => ({}))

  if (!article_id || typeof body !== 'string' || !body.trim()) {
    return NextResponse.json({ error: 'A message is required.' }, { status: 400 })
  }
  if (body.length > MAX_BODY) {
    return NextResponse.json({ error: 'That message is too long.' }, { status: 400 })
  }

  // Scoped to the sender's own article, so an id from elsewhere cannot be
  // replied into.
  const { data: article } = await supabase
    .from('articles')
    .select('id')
    .eq('id', article_id)
    .eq('user_id', user.id)
    .single()

  if (!article) return NextResponse.json({ error: 'Article not found' }, { status: 404 })

  const actor = await teamName(supabase, user.id)

  const { data: comment, error } = await supabase
    .from('article_comments')
    .insert({
      article_id,
      user_id: user.id,
      body: body.trim(),
      is_billable: false,
      author_side: 'team',
      author_name: actor,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logEvent(supabase, {
    articleId: article_id,
    userId: user.id,
    kind: 'commented',
    side: 'team',
    actor,
    detail: excerpt(body),
  })

  return NextResponse.json({ comment }, { status: 201 })
}
