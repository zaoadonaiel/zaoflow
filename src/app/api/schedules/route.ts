import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { calcNextRunMulti } from '@/lib/schedule-utils'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: schedules, error } = await supabase
    .from('schedules')
    .select('*, sites(name, url)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ schedules })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { name, site_id, frequency, custom_cron, times_of_day, timezone, ai_model, topic_prompt, wp_category_id } = body

  if (!name || !site_id || !frequency || !topic_prompt) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const times: string[] = (times_of_day?.length ? times_of_day : ['09:00'])

  const { data: site } = await supabase.from('sites').select('id').eq('id', site_id).eq('user_id', user.id).single()
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  const nextRun = calcNextRunMulti(frequency, times)

  const { data: schedule, error } = await supabase.from('schedules').insert({
    user_id: user.id,
    name,
    site_id,
    frequency,
    custom_cron: custom_cron || null,
    time_of_day: times[0],
    times_of_day: times,
    timezone: timezone || 'UTC',
    ai_model: ai_model || 'anthropic/claude-sonnet-4.5',
    topic_prompt,
    wp_category_id: wp_category_id || null,
    is_active: true,
    articles_generated: 0,
    next_run: nextRun.toISOString(),
  }).select('*, sites(name, url)').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ schedule }, { status: 201 })
}
