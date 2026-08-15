import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { publishPost, uploadMedia } from '@/lib/wordpress'

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { articleId, scheduledAt } = await req.json()
  if (!articleId) return NextResponse.json({ error: 'articleId is required' }, { status: 400 })

  // Load article + site
  const { data: article } = await supabase
    .from('articles')
    .select('*, sites(*)')
    .eq('id', articleId)
    .eq('user_id', user.id)
    .single()

  if (!article) return NextResponse.json({ error: 'Article not found' }, { status: 404 })

  const site = (article as Record<string, unknown>).sites as {
    url: string; wp_username: string; wp_app_password: string
  }
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  // Update article status to publishing
  await supabase.from('articles').update({ status: 'publishing' }).eq('id', articleId)

  // Create publish log entry
  const { data: logEntry } = await supabase.from('publish_logs').insert({
    article_id: articleId,
    site_id: article.site_id,
    user_id: user.id,
    status: 'pending',
  }).select().single()

  try {
    const postStatus = scheduledAt ? 'future' : 'publish'

    // Upload featured image to WordPress if present
    let featuredMediaId: number | undefined
    let imageWarning: string | undefined
    if (article.featured_image_url) {
      try {
        const imgUrl = article.featured_image_url as string
        const ext = imgUrl.includes('.png') ? '.png' : imgUrl.includes('.webp') ? '.webp' : '.jpg'
        featuredMediaId = await uploadMedia({
          siteUrl: site.url,
          username: site.wp_username,
          appPassword: site.wp_app_password,
          imageUrl: imgUrl,
          filename: `${article.slug || article.id}${ext}`,
        })
      } catch (imgErr) {
        imageWarning = imgErr instanceof Error ? imgErr.message : 'Featured image upload failed'
      }
    }

    const wpResult = await publishPost({
      siteUrl: site.url,
      username: site.wp_username,
      appPassword: site.wp_app_password,
      post: {
        title: article.title,
        content: article.content,
        excerpt: article.excerpt || '',
        status: postStatus,
        date: scheduledAt || undefined,
        categories: article.wp_category_id ? [article.wp_category_id] : undefined,
        slug: article.slug || undefined,
        featuredMediaId,
        focusKeyphrase: article.focus_keyphrase || undefined,
        keyphraseSynonyms: article.keyphrase_synonyms || undefined,
        yoastTitle: article.yoast_title || undefined,
        yoastMetaDescription: article.yoast_meta_description || undefined,
      },
    })

    // Update article as published
    await supabase.from('articles').update({
      status: 'published',
      published_at: new Date().toISOString(),
      wp_post_id: wpResult.id,
      wp_post_url: wpResult.link,
      updated_at: new Date().toISOString(),
    }).eq('id', articleId)

    // Update log
    if (logEntry) {
      await supabase.from('publish_logs').update({
        status: 'success',
        wp_post_id: wpResult.id,
        wp_post_url: wpResult.link,
      }).eq('id', logEntry.id)
    }

    return NextResponse.json({ success: true, id: wpResult.id, url: wpResult.link, imageWarning })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Publish failed'

    await supabase.from('articles').update({
      status: 'failed',
      updated_at: new Date().toISOString(),
    }).eq('id', articleId)

    if (logEntry) {
      await supabase.from('publish_logs').update({
        status: 'failed',
        error_message: msg,
      }).eq('id', logEntry.id)
    }

    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
