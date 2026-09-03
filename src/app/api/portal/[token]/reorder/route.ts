import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortalSession } from '@/lib/portal-session'
import { checkOrder, reorderQueue } from '@/lib/reorder-queue'

interface Body {
  /** Article ids in the order the client wants them published. */
  order?: string[]
}

/**
 * Reordering the queue from the client portal.
 *
 * The dealing itself — dates stay put, articles move between them, WordPress is
 * mirrored — lives in `reorder-queue`, shared with the team's own rearranger so
 * a shuffle means the same thing whichever side made it.
 *
 * Gated on the access code, like the rest of the portal, then run on the
 * service-role client against the token itself. It will only ever touch
 * scheduled, unarchived, still-future articles belonging to this portal's site.
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

  const body = (await req.json().catch(() => ({}))) as Body
  const order = body.order

  const bad = checkOrder(order)
  if (bad) return NextResponse.json({ error: bad.error }, { status: bad.status })

  const { data: portal, error: portalError } = await supabase
    .from('client_portals')
    .select('id, user_id, site_id, client_name, is_active')
    .eq('token', params.token)
    .single()

  if (portalError && portalError.code !== 'PGRST116') {
    console.error('[portal] reorder portal lookup failed:', portalError)
    return NextResponse.json({ error: 'The order could not be saved.' }, { status: 500 })
  }
  if (!portal || !portal.is_active) {
    return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })
  }

  const { data: articles, error: articlesError } = await supabase
    .from('articles')
    .select('id, title, scheduled_at, scheduled_tz, status, wp_post_id, sites(url, wp_username, wp_app_password)')
    .eq('site_id', portal.site_id)
    .in('id', order!)
    .eq('status', 'scheduled')
    .is('archived_at', null)

  if (articlesError) {
    console.error('[portal] reorder article query failed:', articlesError)
    return NextResponse.json({ error: 'The order could not be saved.' }, { status: 500 })
  }

  const result = await reorderQueue(supabase, articles || [], order!)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  // The team's activity trail. Best-effort on purpose: this is a record of what
  // the client did, and failing to write it must not undo what they did.
  if (result.moved.length) {
    try {
      await supabase.from('article_events').insert(
        result.moved.map((id) => ({
          article_id: id,
          user_id: portal.user_id,
          kind: 'reordered',
          side: 'client',
          actor: portal.client_name || 'Client',
          portal_id: portal.id,
        }))
      )
    } catch {}
  }

  return NextResponse.json({ moved: result.moved.length })
}
