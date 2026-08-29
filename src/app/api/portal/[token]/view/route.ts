import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortalSession } from '@/lib/portal-session'

/**
 * Records that the client opened an article.
 *
 * Only the portal can reach this, and reaching the portal means the client
 * typed the access code we gave them — so a timestamp written here always
 * means the client looked, never the team. The dashboard has no path to this
 * route.
 *
 * First open wins: the stamp is when they first saw it, not when they last did.
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
  const { article_id } = await req.json()
  if (!article_id) return NextResponse.json({ error: 'article_id required' }, { status: 400 })

  const { data: portal } = await supabase
    .from('client_portals')
    .select('id, user_id, site_id, client_name, is_active')
    .eq('token', params.token)
    .single()

  if (!portal || !portal.is_active) {
    return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })
  }

  const { data: article } = await supabase
    .from('articles')
    .select('id, client_viewed_at')
    .eq('id', article_id)
    .eq('site_id', portal.site_id)
    .single()

  if (!article) return NextResponse.json({ error: 'Article not found.' }, { status: 404 })

  const viewedAt = new Date().toISOString()

  // Every open is logged, so the team can see how many passes the client made.
  await supabase.from('article_events').insert({
    article_id,
    user_id: portal.user_id,
    kind: 'viewed',
    side: 'client',
    actor: portal.client_name || 'Client',
    portal_id: portal.id,
  })

  // client_viewed_at stays "first seen" — it drives the Unseen -> Approved
  // badge, which is about whether they have looked at all, not how often.
  if (article.client_viewed_at) {
    return NextResponse.json({ viewed_at: article.client_viewed_at, already: true })
  }

  await supabase
    .from('articles')
    .update({ client_viewed_at: viewedAt })
    .eq('id', article_id)

  return NextResponse.json({ viewed_at: viewedAt, already: false })
}
