import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortalSession } from '@/lib/portal-session'
import { logEvent } from '@/lib/collab-server'
import { excerpt } from '@/lib/collab'

const MAX_BODY = 4000

/**
 * A client leaving a revision note. Gated on the access code, then on the
 * portal token.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  // The access code, not the link, is what opens this. Everything below runs on
  // the service-role client, so the gate has to come first.
  const gate = await requirePortalSession(params.token)
  if (gate) return gate

  const supabase = createServiceClient()
  const { article_id, body } = await req.json()

  if (!article_id || typeof body !== 'string' || !body.trim()) {
    return NextResponse.json({ error: 'A comment is required.' }, { status: 400 })
  }
  if (body.length > MAX_BODY) {
    return NextResponse.json({ error: 'That comment is too long.' }, { status: 400 })
  }

  const { data: portal, error: portalError } = await supabase
    .from('client_portals')
    .select('id, user_id, site_id, client_name, is_active')
    .eq('token', params.token)
    .single()

  // Only "no row matched" means a bad link. Anything else is our fault and
  // must not be blamed on the client's URL.
  if (portalError && portalError.code !== 'PGRST116') {
    console.error('[portal] comment portal lookup failed:', portalError)
    return NextResponse.json({ error: 'Your comment could not be sent. Please try again.' }, { status: 500 })
  }

  if (!portal || !portal.is_active) {
    return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })
  }

  // The article must belong to this portal's site, or the token would let a
  // client comment on anyone's article by guessing an id.
  const { data: article } = await supabase
    .from('articles')
    .select('id, status, site_id')
    .eq('id', article_id)
    .eq('site_id', portal.site_id)
    .single()

  if (!article) {
    return NextResponse.json({ error: 'Article not found.' }, { status: 404 })
  }
  if (article.status !== 'scheduled') {
    return NextResponse.json(
      { error: 'This article has already been published and can no longer be revised.' },
      { status: 400 }
    )
  }

  // One included revision per article; everything after it is chargeable. We
  // count rather than block — the client is never stopped from flagging a
  // problem, the extra is just recorded.
  //
  // Only the client's own messages count. The thread carries both sides now,
  // and billing a client for the reply they were sent would be indefensible.
  const { count } = await supabase
    .from('article_comments')
    .select('id', { count: 'exact', head: true })
    .eq('article_id', article_id)
    .eq('author_side', 'client')

  const isBillable = (count || 0) >= 1
  const authorName = portal.client_name || 'Client'

  const { data: comment, error } = await supabase
    .from('article_comments')
    .insert({
      article_id,
      portal_id: portal.id,
      user_id: portal.user_id,
      body: body.trim(),
      is_billable: isBillable,
      author_side: 'client',
      author_name: authorName,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logEvent(supabase, {
    articleId: article_id,
    userId: portal.user_id,
    kind: 'commented',
    side: 'client',
    actor: authorName,
    detail: excerpt(body),
    portalId: portal.id,
  })

  return NextResponse.json({ comment, is_billable: isBillable }, { status: 201 })
}
