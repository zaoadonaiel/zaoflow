import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

// Webhook endpoint called by the WordPress plugin to report publish status
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { article_id, secret_token, status, wp_post_id, wp_post_url, error: wpError } = body

  if (!article_id || !secret_token) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Verify the secret token matches the site
  const { data: article } = await supabase
    .from('articles')
    .select('id, user_id, site_id')
    .eq('id', article_id)
    .single()

  if (!article) return NextResponse.json({ error: 'Article not found' }, { status: 404 })

  const { data: site } = await supabase
    .from('sites')
    .select('secret_token')
    .eq('id', article.site_id)
    .single()

  if (!site || site.secret_token !== secret_token) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 403 })
  }

  if (status === 'published') {
    await supabase.from('articles').update({
      status: 'published',
      published_at: new Date().toISOString(),
      wp_post_id,
      wp_post_url,
      updated_at: new Date().toISOString(),
    }).eq('id', article_id)

    await supabase.from('publish_logs').insert({
      article_id,
      site_id: article.site_id,
      user_id: article.user_id,
      status: 'success',
      wp_post_id,
      wp_post_url,
    })
  } else if (status === 'failed') {
    await supabase.from('articles').update({
      status: 'failed',
      updated_at: new Date().toISOString(),
    }).eq('id', article_id)

    await supabase.from('publish_logs').insert({
      article_id,
      site_id: article.site_id,
      user_id: article.user_id,
      status: 'failed',
      error_message: wpError || 'Unknown error',
    })
  }

  return NextResponse.json({ received: true })
}
