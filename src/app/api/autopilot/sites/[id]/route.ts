import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Toggle Autopilot state for one site.
 *
 * Accepts partial updates — the client sends only the field it changed.
 * The one cross-field rule enforced here is that Autopilot cannot be
 * turned ON without a model combo picked, since the tick needs to know
 * which four models to run. The check is done against the *post-patch*
 * state, not the incoming body alone, so setting a combo and flipping
 * the switch in the same request works.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))

  const patch: {
    autopilot_enabled?: boolean
    autopilot_paused?: boolean
    autopilot_model_combo_id?: string | null
    updated_at: string
  } = { updated_at: new Date().toISOString() }

  if (typeof body?.autopilot_enabled === 'boolean') patch.autopilot_enabled = body.autopilot_enabled
  if (typeof body?.autopilot_paused === 'boolean') patch.autopilot_paused = body.autopilot_paused
  if ('autopilot_model_combo_id' in (body ?? {})) {
    const raw = body.autopilot_model_combo_id
    patch.autopilot_model_combo_id = typeof raw === 'string' && raw ? raw : null
  }

  const { data: current, error: readErr } = await supabase
    .from('sites')
    .select('autopilot_enabled, autopilot_paused, autopilot_model_combo_id')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()
  if (readErr || !current) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  }

  const nextEnabled = patch.autopilot_enabled ?? current.autopilot_enabled
  const nextCombo =
    'autopilot_model_combo_id' in patch
      ? patch.autopilot_model_combo_id
      : current.autopilot_model_combo_id

  if (nextEnabled && !nextCombo) {
    return NextResponse.json(
      { error: 'Pick a Model Combo before turning Autopilot on.' },
      { status: 400 },
    )
  }

  // Verify combo ownership when one is being set. Without this a caller
  // could set someone else's combo id — RLS on model_combos protects
  // reads, but the FK on sites doesn't scope to user_id.
  if (nextCombo && ('autopilot_model_combo_id' in patch)) {
    const { data: combo } = await supabase
      .from('model_combos')
      .select('id')
      .eq('id', nextCombo)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!combo) {
      return NextResponse.json({ error: 'Model combo not found' }, { status: 404 })
    }
  }

  const { data, error } = await supabase
    .from('sites')
    .update(patch)
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select(`
      id, name, url, status, default_tz,
      autopilot_enabled, autopilot_paused, autopilot_model_combo_id,
      model_combos:autopilot_model_combo_id (id, name, idea_model, article_model, seo_model, image_model)
    `)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ site: data })
}
