import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * The AI model each generator should open with on a fresh article: the one
 * this user has spent the most calls on for that step, so the picker lands
 * on their habit without them having to reset it every time.
 *
 * Returns { models: { idea?, article?, seo?, image? } } — keys are only
 * present when there is any usage history for that step.
 */
export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase.rpc('get_most_used_models', { uid: user.id })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const models: Record<string, string> = {}
  for (const row of (data ?? []) as { step: string; model: string }[]) {
    if (row.step && row.model) models[row.step] = row.model
  }
  return NextResponse.json({ models })
}
