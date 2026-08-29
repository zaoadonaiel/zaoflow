import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { reconcileScheduled } from '@/lib/reconcile-schedule'

/**
 * Brings the Scheduled queue back in line with what WordPress actually did.
 *
 * The Schedules page calls this before trusting its own list, because a slot
 * that has already fired leaves our row stale — the article is live on the site
 * while still sitting under Scheduled here.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const siteId = typeof body?.site_id === 'string' ? body.site_id : null

  try {
    const result = await reconcileScheduled({ supabase, userId: user.id, siteId })
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not check WordPress'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
