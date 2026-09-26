import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Sites list for the Autopilot page.
 *
 * One row per site the user owns, with the fields the Autopilot toggles
 * read plus the currently linked model combo (joined, so the panel can
 * render "Combo: <name>" without a second round-trip). RLS on `sites`
 * scopes to the caller — no explicit user filter needed, but the
 * `.eq('user_id')` is here defensively in case the policy is ever
 * relaxed.
 */
export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('sites')
    .select(`
      id, name, url, status, default_tz,
      autopilot_enabled, autopilot_paused, autopilot_model_combo_id,
      model_combos:autopilot_model_combo_id (id, name, idea_model, article_model, seo_model, image_model)
    `)
    .eq('user_id', user.id)
    .order('name', { ascending: true })

  if (error) {
    // Migration 040 hasn't run yet — say so explicitly so the UI shows a
    // usable message rather than a generic 500.
    const missing = /column .* does not exist|autopilot/i.test(error.message)
    return NextResponse.json(
      { error: missing
        ? 'Autopilot columns are missing — run supabase/migrations/040_site_autopilot.sql.'
        : error.message },
      { status: missing ? 503 : 500 },
    )
  }

  return NextResponse.json({ sites: data ?? [] })
}
