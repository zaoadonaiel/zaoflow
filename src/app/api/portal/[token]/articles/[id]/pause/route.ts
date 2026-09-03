import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortalSession } from '@/lib/portal-session'
import { logEvent } from '@/lib/collab-server'

/**
 * The client's approve / pause switch.
 *
 * Approved is the resting state: an article nobody touches goes out on its
 * schedule. Pausing is the only way to stop that, and it stays paused until
 * somebody says otherwise -- an article left paused and forgotten is an
 * article that does not publish, which is the point of the control.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string; id: string } }
) {
  // The access code, not the link, is what opens this. Everything below runs on
  // the service-role client, so the gate has to come first.
  const gate = await requirePortalSession(params.token)
  if (gate) return gate

  const supabase = createServiceClient()
  const { paused } = await req.json().catch(() => ({}))

  if (typeof paused !== 'boolean') {
    return NextResponse.json({ error: 'Say whether to pause or approve.' }, { status: 400 })
  }

  const { data: portal, error: portalError } = await supabase
    .from('client_portals')
    .select('id, user_id, site_id, client_name, is_active')
    .eq('token', params.token)
    .single()

  if (portalError && portalError.code !== 'PGRST116') {
    console.error('[portal] pause portal lookup failed:', portalError)
    return NextResponse.json({ error: 'That could not be saved.' }, { status: 500 })
  }
  if (!portal || !portal.is_active) {
    return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })
  }

  const { data: article } = await supabase
    .from('articles')
    .select('id, status, is_paused')
    .eq('id', params.id)
    .eq('site_id', portal.site_id)
    .single()

  if (!article) return NextResponse.json({ error: 'Article not found.' }, { status: 404 })
  if (article.status !== 'scheduled') {
    return NextResponse.json(
      { error: 'This article has already been published.' },
      { status: 400 }
    )
  }

  const { error } = await supabase
    .from('articles')
    .update({ is_paused: paused, updated_at: new Date().toISOString() })
    .eq('id', article.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (article.is_paused !== paused) {
    await logEvent(supabase, {
      articleId: article.id,
      userId: portal.user_id,
      kind: paused ? 'paused' : 'resumed',
      side: 'client',
      actor: portal.client_name || 'Client',
      portalId: portal.id,
    })
  }

  return NextResponse.json({ is_paused: paused })
}
