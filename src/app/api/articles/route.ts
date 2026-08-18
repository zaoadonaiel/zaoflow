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
    .from('articles')
    .select('*, sites(name, url)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (search) query = query.ilike('title', `%${search}%`)
  if (status) query = query.eq('status', status)
  if (siteId) query = query.eq('site_id', siteId)

  const { data: articles, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ articles })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    site_id, title, content, keywords, ai_model, status, scheduled_at,
    word_count, excerpt, meta_description,
    focus_keyphrase, keyphrase_synonyms, yoast_title, yoast_meta_description, slug,
    featured_image_url, featured_image_prompt, wp_category_id,
  } = body

  if (!title || !site_id) {
    return NextResponse.json({ error: 'Title and site are required' }, { status: 400 })
  }

  // Verify site belongs to user
  const { data: site } = await supabase.from('sites').select('id').eq('id', site_id).eq('user_id', user.id).single()
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  const { data: article, error } = await supabase.from('articles').insert({
    user_id: user.id,
    site_id,
    title,
    content: content || '',
    keywords: keywords || [],
    ai_model,
    status: status || 'draft',
    scheduled_at: scheduled_at || null,
    word_count: word_count || null,
    excerpt: excerpt || null,
    meta_description: meta_description || null,
    focus_keyphrase: focus_keyphrase || null,
    keyphrase_synonyms: keyphrase_synonyms || null,
    yoast_title: yoast_title || null,
    yoast_meta_description: yoast_meta_description || null,
    slug: slug || null,
    featured_image_url: featured_image_url || null,
    featured_image_prompt: featured_image_prompt || null,
    // Dropping this silently sent every new article to Uncategorized, since
    // the publish route reads it back off the row to set WP categories
    wp_category_id: wp_category_id || null,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ article }, { status: 201 })
}
