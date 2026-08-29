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
  // Archived articles are hidden everywhere except the Archive page, which asks
  // for them explicitly with ?archived=true.
  const archived = searchParams.get('archived') === 'true'
  // Only the Schedules page wants the activity trail; everything else skips
  // the extra query.
  const withEvents = searchParams.get('events') === 'true'
  // Internal cost breakdown; only the Cost tab asks for it.
  const withCost = searchParams.get('cost') === 'true'

  // Just the totals for the current scope — the Schedules page puts them
  // beside its tabs, and a number does not need the rows behind it.
  if (searchParams.get('counts') === 'true') {
    const scoped = (status: string) => {
      let q = supabase
        .from('articles')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', status)
      if (siteId) q = q.eq('site_id', siteId)
      return archived ? q.not('archived_at', 'is', null) : q.is('archived_at', null)
    }

    const [published, scheduled] = await Promise.all([scoped('published'), scoped('scheduled')])
    return NextResponse.json({
      counts: {
        published: published.count ?? 0,
        scheduled: scheduled.count ?? 0,
      },
    })
  }

  let query = supabase
    .from('articles')
    .select('*, sites(name, url)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (search) query = query.ilike('title', `%${search}%`)
  if (status) query = query.eq('status', status)
  if (siteId) query = query.eq('site_id', siteId)
  query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null)

  const { data: articles, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (withEvents && articles?.length) {
    const { data: events } = await supabase
      .from('article_events')
      .select('id, article_id, kind, actor, created_at')
      .in('article_id', articles.map((a) => a.id))
      .order('created_at', { ascending: true })

    const byArticle = new Map<string, typeof events>()
    for (const e of events || []) {
      const list = byArticle.get(e.article_id) || []
      list.push(e)
      byArticle.set(e.article_id, list)
    }
    for (const a of articles) {
      ;(a as Record<string, unknown>).events = byArticle.get(a.id) || []
    }
  }

  if (withCost && articles?.length) {
    const { data: usage } = await supabase
      .from('ai_usage')
      .select('id, article_id, step, model, total_tokens, cost_usd, created_at')
      .in('article_id', articles.map((a) => a.id))
      .order('created_at', { ascending: true })

    const byArticle = new Map<string, typeof usage>()
    for (const u of usage || []) {
      const list = byArticle.get(u.article_id) || []
      list.push(u)
      byArticle.set(u.article_id, list)
    }
    for (const a of articles) {
      ;(a as Record<string, unknown>).usage = byArticle.get(a.id) || []
    }
  }

  return NextResponse.json({ articles })
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
    featured_image_url, featured_image_prompt, featured_image_alt, wp_category_id, usage_ids,
  } = body

  if (!title || !site_id) {
    return NextResponse.json({ error: 'Title and site are required' }, { status: 400 })
  }

  // Verify site belongs to user
  const { data: site } = await supabase.from('sites').select('id').eq('id', site_id).eq('user_id', user.id).single()
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  const insert = {
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
  }

  // featured_image_alt ships in migration 020. On a database where that has
  // not run, the article still saves -- without the alt rather than not at all.
  const { data: article, error } = await writeWithOptionalColumn<{ id: string }>(
    insert,
    'featured_image_alt',
    (payload) => supabase.from('articles').insert(payload).select().single()
  )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!article) return NextResponse.json({ error: 'The article did not save' }, { status: 500 })

  // Generation happens before the article exists, so its cost rows were written
  // unattached. Claim them now — scoped to this user and to rows not already
  // claimed, so an id cannot be replayed onto someone else's article.
  if (Array.isArray(usage_ids) && usage_ids.length) {
    await supabase
      .from('ai_usage')
      .update({ article_id: article.id })
      .in('id', usage_ids.slice(0, 20))
      .eq('user_id', user.id)
      .is('article_id', null)
  }

  return NextResponse.json({ article }, { status: 201 })
}
