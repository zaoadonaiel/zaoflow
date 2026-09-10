import { NextRequest, NextResponse } from 'next/server'
import { tasks } from '@trigger.dev/sdk/v3'
import { createClient } from '@/lib/supabase/server'
import type { autoPostRunTask } from '@/trigger/auto-post-run'

interface Body {
  city_list_id?: string
  site_id?: string
  source_kind?: 'post' | 'page'
  source_page_id?: number
  source_city?: string
  ai_model?: string | null
  instruction_id?: string | null
  rewrite_similarity?: 10 | 25 | 50 | 90 | null
  city_only_mode?: boolean
  override_existing?: boolean
  set_location_meta?: boolean
}

/**
 * Kicks off an Auto Post batch:
 *   1. loads the city list, parses every city
 *   2. inserts a `city_list_runs` row + one `city_list_run_items` row per city
 *   3. hands the run id to the `auto-post-run` Trigger.dev task
 *   4. writes the resulting run id back on the row so the UI can subscribe
 *
 * The heavy lifting (WP round-trips per city, AI rewrite, publish) happens
 * inside the Trigger task so a 30+ city batch survives the browser closing.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Body

  if (!body.city_list_id) return NextResponse.json({ error: 'city_list_id is required' }, { status: 400 })
  if (!body.site_id) return NextResponse.json({ error: 'site_id is required' }, { status: 400 })
  if (!body.source_page_id) return NextResponse.json({ error: 'source_page_id is required' }, { status: 400 })
  if (!body.source_city?.trim()) return NextResponse.json({ error: 'source_city is required' }, { status: 400 })
  if (body.source_kind !== 'post' && body.source_kind !== 'page') {
    return NextResponse.json({ error: 'source_kind must be "post" or "page"' }, { status: 400 })
  }

  const cityOnlyMode = Boolean(body.city_only_mode)
  const overrideExisting = body.override_existing ?? true
  const setLocationMeta = body.set_location_meta ?? true

  if (!cityOnlyMode) {
    if (!body.ai_model) return NextResponse.json({ error: 'ai_model is required unless city_only_mode is true' }, { status: 400 })
    if (!body.rewrite_similarity) return NextResponse.json({ error: 'rewrite_similarity is required unless city_only_mode is true' }, { status: 400 })
  }

  const { data: cityList } = await supabase
    .from('city_lists')
    .select('id, csv_content')
    .eq('id', body.city_list_id)
    .eq('user_id', user.id)
    .single()
  if (!cityList) return NextResponse.json({ error: 'City list not found' }, { status: 404 })

  const cities = parseCsvCities(cityList.csv_content)
  if (cities.length === 0) {
    return NextResponse.json({ error: 'City list is empty' }, { status: 400 })
  }

  const { data: site } = await supabase
    .from('sites')
    .select('id, site_type, url')
    .eq('id', body.site_id)
    .eq('user_id', user.id)
    .single()
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  if (site.site_type !== 'wordpress') {
    return NextResponse.json({ error: 'Auto Post only supports WordPress sites' }, { status: 400 })
  }

  const { data: run, error: runErr } = await supabase
    .from('city_list_runs')
    .insert({
      user_id: user.id,
      city_list_id: cityList.id,
      site_id: site.id,
      source_kind: body.source_kind,
      source_page_id: body.source_page_id,
      source_city: body.source_city.trim(),
      ai_model: body.ai_model || null,
      instruction_id: body.instruction_id || null,
      rewrite_similarity: cityOnlyMode ? null : body.rewrite_similarity,
      city_only_mode: cityOnlyMode,
      override_existing: overrideExisting,
      set_location_meta: setLocationMeta,
      total: cities.length,
      status: 'queued',
    })
    .select('id')
    .single()
  if (runErr || !run) {
    return NextResponse.json({ error: runErr?.message || 'Failed to create run' }, { status: 500 })
  }

  const itemRows = cities.map((c, i) => ({
    run_id: run.id,
    user_id: user.id,
    position: i,
    target_city: c,
    status: 'pending',
  }))
  const { error: itemsErr } = await supabase.from('city_list_run_items').insert(itemRows)
  if (itemsErr) {
    await supabase.from('city_list_runs').delete().eq('id', run.id)
    return NextResponse.json({ error: itemsErr.message }, { status: 500 })
  }

  try {
    const handle = await tasks.trigger<typeof autoPostRunTask>('auto-post-run', {
      runId: run.id,
      userId: user.id,
    })
    await supabase
      .from('city_list_runs')
      .update({ trigger_run_id: handle.id, updated_at: new Date().toISOString() })
      .eq('id', run.id)
    return NextResponse.json({ runId: run.id, triggerRunId: handle.id, total: cities.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to enqueue Trigger.dev task'
    await supabase
      .from('city_list_runs')
      .update({ status: 'failed', error: msg, updated_at: new Date().toISOString() })
      .eq('id', run.id)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

/** Parse a two-column `city,state` CSV into display strings. Missing state
 *  cells just produce a plain city name. Blank / header rows are dropped. */
function parseCsvCities(csv: string): string[] {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (i === 0 && /^city\s*,/i.test(line)) continue
    const [rawCity, rawState] = line.split(',').map((x) => x?.trim() || '')
    if (!rawCity) continue
    out.push(rawState ? `${rawCity} ${rawState.toUpperCase()}` : rawCity)
  }
  return out
}
