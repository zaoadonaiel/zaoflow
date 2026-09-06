import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search')
  const status = searchParams.get('status')
  const siteId = searchParams.get('site_id')

  let query = supabase
    .from('seo_pages')
    .select('*, sites(name, url)')
    .eq('user_id', user.id)

  if (search) query = query.ilike('title', `%${search}%`)
  if (status) query = query.eq('status', status)
  if (siteId) query = query.eq('site_id', siteId)

  query = status === 'scheduled'
    ? query.order('scheduled_at', { ascending: true, nullsFirst: false })
    : query.order('created_at', { ascending: false })

  const { data: seoPages, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ seoPages })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    site_id,
    source_page_id, source_slug, source_title,
    source_city, target_city,
    title, slug, content, excerpt,
    featured_image_url, featured_image_prompt, featured_image_alt,
    focus_keyphrase, keyphrase_synonyms, yoast_title, yoast_meta_description,
    ai_model, instruction_id, rewrite_similarity,
    set_location_meta,
    status, scheduled_at, scheduled_tz,
  } = body

  if (!title || !site_id) {
    return NextResponse.json({ error: 'Title and site are required' }, { status: 400 })
  }

  const { data: site } = await supabase
    .from('sites')
    .select('id, site_type')
    .eq('id', site_id)
    .eq('user_id', user.id)
    .single()
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  if (site.site_type !== 'wordpress') {
    return NextResponse.json({ error: 'SEO Pages currently support WordPress sites only' }, { status: 400 })
  }

  const { data: seoPage, error } = await supabase.from('seo_pages').insert({
    user_id: user.id,
    site_id,
    source_page_id: source_page_id || null,
    source_slug: source_slug || null,
    source_title: source_title || null,
    source_city: source_city || null,
    target_city: target_city || null,
    title,
    slug: slug || null,
    content: content || '',
    excerpt: excerpt || null,
    featured_image_url: featured_image_url || null,
    featured_image_prompt: featured_image_prompt || null,
    featured_image_alt: featured_image_alt || null,
    focus_keyphrase: focus_keyphrase || null,
    keyphrase_synonyms: keyphrase_synonyms || null,
    yoast_title: yoast_title || null,
    yoast_meta_description: yoast_meta_description || null,
    ai_model: ai_model || null,
    instruction_id: instruction_id || null,
    rewrite_similarity: rewrite_similarity || null,
    set_location_meta: typeof set_location_meta === 'boolean' ? set_location_meta : true,
    status: status || 'draft',
    scheduled_at: scheduled_at || null,
    scheduled_tz: scheduled_tz || null,
  }).select().single()

  if (error || !seoPage) {
    return NextResponse.json({ error: error?.message || 'Insert failed' }, { status: 500 })
  }

  return NextResponse.json({ seoPage }, { status: 201 })
}
