import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/seo-pages/auto-post/runs/[id]
 *
 * Progress feed for the Auto Post UI: returns the run header plus one entry
 * per city with its current status and (when published) the live URL. The UI
 * polls this every ~2s while a run is active.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: run, error: runErr } = await supabase
    .from('city_list_runs')
    .select('id, status, total, succeeded, failed, error, created_at, updated_at, city_list_id, site_id, source_kind, source_page_id, source_city, ai_model, rewrite_similarity, city_only_mode, override_existing')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()
  if (runErr || !run) return NextResponse.json({ error: runErr?.message || 'Not found' }, { status: 404 })

  const { data: items, error: itemsErr } = await supabase
    .from('city_list_run_items')
    .select('id, position, target_city, status, error, wp_page_url, seo_page_id, started_at, completed_at')
    .eq('run_id', params.id)
    .eq('user_id', user.id)
    .order('position', { ascending: true })
  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 })

  return NextResponse.json({ run, items: items || [] })
}
