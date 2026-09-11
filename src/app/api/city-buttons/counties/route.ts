import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Cached county assignments for a site's WordPress pages. Reads only —
 * writes go through /api/city-buttons/classify.
 */
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const siteId = searchParams.get('site_id')
  if (!siteId) return NextResponse.json({ error: 'site_id is required' }, { status: 400 })

  const { data, error } = await supabase
    .from('page_counties')
    .select('wp_page_id, county, state, ai_model, updated_at')
    .eq('user_id', user.id)
    .eq('site_id', siteId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ counties: data || [] })
}
