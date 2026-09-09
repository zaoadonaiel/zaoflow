import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const EDITABLE_FIELDS = [
  'title', 'slug', 'content', 'excerpt',
  'source_kind',
  'source_page_id', 'source_slug', 'source_title', 'source_city', 'target_city',
  'featured_image_url', 'featured_image_prompt', 'featured_image_alt',
  'focus_keyphrase', 'keyphrase_synonyms', 'yoast_title', 'yoast_meta_description',
  'ai_model', 'instruction_id', 'rewrite_similarity',
  'set_location_meta',
  'status', 'scheduled_at', 'scheduled_tz',
  'site_id',
] as const

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: seoPage, error } = await supabase
    .from('seo_pages')
    .select('*, sites(*)')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (error || !seoPage) return NextResponse.json({ error: 'SEO page not found' }, { status: 404 })

  // Aggregate every AI usage row linked to this SEO page so the builder can
  // show what the clone cost. A `null` cost_usd (image models we can't price)
  // is treated as 0 for the sum but reported separately so the UI can hint
  // that the true figure may be higher.
  const { data: usageRows } = await supabase
    .from('ai_usage')
    .select('cost_usd')
    .eq('user_id', user.id)
    .eq('seo_page_id', params.id)

  const rows = (usageRows as Array<{ cost_usd: number | null }> | null) ?? []
  const costTotal = rows.reduce((n, r) => n + (r.cost_usd ?? 0), 0)
  const costUnpriced = rows.filter((r) => r.cost_usd === null).length

  return NextResponse.json({
    seoPage,
    costTotal,
    costUnpriced,
    costCount: rows.length,
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of EDITABLE_FIELDS) {
    if (key in body) updates[key] = body[key]
  }

  const { data: seoPage, error } = await supabase
    .from('seo_pages')
    .update(updates)
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error || !seoPage) return NextResponse.json({ error: error?.message || 'Update failed' }, { status: 500 })
  return NextResponse.json({ seoPage })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('seo_pages')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
