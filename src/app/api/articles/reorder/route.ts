import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkOrder, reorderQueue } from '@/lib/reorder-queue'

interface Body {
  /** Article ids in the order they should publish in. */
  order?: string[]
}

/**
 * Rearranging the queue from the team's side — the scheduling calendar's
 * Rearrange list.
 *
 * The same deal the client portal makes: the dates stay where they are and the
 * articles move between them, so a month's cadence survives any amount of
 * shuffling. Scoped to the signed-in user's own articles, which is the only
 * difference from the portal's copy — everything else is shared.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Body
  const order = body.order

  const bad = checkOrder(order)
  if (bad) return NextResponse.json({ error: bad.error }, { status: bad.status })

  const { data: articles, error } = await supabase
    .from('articles')
    .select('id, title, scheduled_at, scheduled_tz, status, wp_post_id, sites(url, wp_username, wp_app_password)')
    .eq('user_id', user.id)
    .in('id', order!)
    .eq('status', 'scheduled')
    .is('archived_at', null)

  if (error) {
    console.error('[articles] reorder query failed:', error)
    return NextResponse.json({ error: 'The order could not be saved.' }, { status: 500 })
  }

  const result = await reorderQueue(supabase, articles || [], order!)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  // The activity trail both sides read. Best-effort: failing to record the
  // move must not undo it.
  if (result.moved.length) {
    try {
      await supabase.from('article_events').insert(
        result.moved.map((id) => ({
          article_id: id,
          user_id: user.id,
          kind: 'reordered',
          side: 'team',
          actor: user.email || 'Team',
        }))
      )
    } catch {}
  }

  return NextResponse.json({ moved: result.moved.length })
}
