import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Autopilot's queued articles for one site.
 *
 * Filters to the two states the Autopilot panel cares about: `scheduled`
 * (ready to publish at `scheduled_at`) and `draft` (autopilot generated
 * something but couldn't finish the pipeline — the user can open it and
 * decide what to do). `published` and `failed` are excluded because the
 * panel's job is showing what is *upcoming*, not history.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('articles')
    .select('id, title, status, scheduled_at, scheduled_tz, created_at')
    .eq('user_id', user.id)
    .eq('site_id', params.id)
    .eq('source', 'autopilot')
    .in('status', ['scheduled', 'draft'])
    .order('scheduled_at', { ascending: true, nullsFirst: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ articles: data ?? [] })
}
