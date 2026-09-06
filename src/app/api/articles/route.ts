import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { writeWithOptionalColumn } from '@/lib/optional-columns'

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

  if (search) query = query.ilike('title', `%${search}%`)
  if (status) query = query.eq('status', status)
  if (siteId) query = query.eq('site_id', siteId)

  // Scheduled articles are most useful in publish order (soonest first).
  // Everything else lists newest-created first.
  query = status === 'scheduled'
    ? query.order('scheduled_at', { ascending: true, nullsFirst: false })
    : query.order('created_at', { ascending: false })

  // Counts are the same regardless of the status filter — they exist so the
  // filter buttons can show what a click would surface. Run alongside the
  // list query so a single request answers both.
  const [{ data: articles, error }, { data: countRows }] = await Promise.all([
    query,
    supabase.rpc('get_article_status_counts', {
      uid: user.id,
      site_filter: siteId || null,
      search_filter: search || null,
    }),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const counts: Record<string, number> = {}
  for (const row of (countRows ?? []) as { status: string; count: number }[]) {
    counts[row.status] = Number(row.count)
  }

  return NextResponse.json({ articles, counts })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    site_id, title, content, keywords, ai_model, status, scheduled_at, scheduled_tz,
    word_count, excerpt, meta_description,
    focus_keyphrase, keyphrase_synonyms, yoast_title, yoast_meta_description, slug,
    featured_image_url, featured_image_prompt, featured_image_alt, wp_category_id,
    usage_ids,
  } = body

  if (!title || !site_id) {
    return NextResponse.json({ error: 'Title and site are required' }, { status: 400 })
  }

  // Verify site belongs to user
  const { data: site } = await supabase.from('sites').select('id').eq('id', site_id).eq('user_id', user.id).single()
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  const { data: article, error } = await writeWithOptionalColumn<{ id: string }>(
    {
      user_id: user.id,
      site_id,
      title,
      content: content || '',
      keywords: keywords || [],
      ai_model,
      status: status || 'draft',
      scheduled_at: scheduled_at || null,
      scheduled_tz: scheduled_tz || null,
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
      featured_image_alt: featured_image_alt || null,
      // Dropping this silently sent every new article to Uncategorized, since
      // the publish route reads it back off the row to set WP categories
      wp_category_id: wp_category_id || null,
    },
    'featured_image_alt',
    (payload) => supabase.from('articles').insert(payload).select().single(),
  )

  if (error || !article) return NextResponse.json({ error: error?.message || 'Insert failed' }, { status: 500 })

  // Attach any generation-cost rows to this article. Each row was written with
  // article_id null while the article did not exist yet — this is the point at
  // which they earn one.
  if (Array.isArray(usage_ids) && usage_ids.length > 0) {
    await supabase
      .from('ai_usage')
      .update({ article_id: article.id })
      .in('id', usage_ids)
      .eq('user_id', user.id)
      .is('article_id', null)
  }

  return NextResponse.json({ article }, { status: 201 })
}
