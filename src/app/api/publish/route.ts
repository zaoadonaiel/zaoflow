import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { publishPost, uploadMedia } from '@/lib/wordpress'
import { publishPost as publishNodePost } from '@/lib/nodejs-site'
import {
  compressImageFromUrl,
  storeCompressedToStorage,
  type ServerCompressionResult,
} from '@/lib/image-compression-server'

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { articleId, scheduledAt, publishAt } = await req.json() as {
    articleId?: string
    /** Future ISO — creates a WP "future" post; WP publishes it at the slot. */
    scheduledAt?: string
    /** Historical ISO — publishes immediately but stamps the WP post's date
     *  with this value. Ignored when `scheduledAt` is set. */
    publishAt?: string
  }
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
    site_type?: 'wordpress' | 'nodejs'
    url: string
    wp_username: string
    wp_app_password: string
    node_api_url: string
    secret_token: string
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

  // Toggle on the article row; default true. See migration 034 and
  // src/lib/publish-article.ts for the twin used by the cron/scheduler path.
  const wantsCompression = (article as { compress_on_publish?: boolean }).compress_on_publish !== false
  const shouldCompress = wantsCompression && !!article.featured_image_url

  if (site.site_type === 'nodejs') {
    // Node.js sites pull the featured URL themselves, so a compressed publish
    // needs the smaller file living somewhere the site can reach -- Supabase
    // storage. The article row is repointed at the compressed URL so a later
    // edit does not silently revert to the pre-compression file.
    let nodeImageUrl = article.featured_image_url || undefined
    let nodeImageWarning: string | undefined
    if (shouldCompress) {
      try {
        const compressed = await compressImageFromUrl(article.featured_image_url as string)
        if (!compressed.skipped) {
          const newUrl = await storeCompressedToStorage(user.id, compressed)
          nodeImageUrl = newUrl
          await supabase
            .from('articles')
            .update({ featured_image_url: newUrl })
            .eq('id', articleId)
            .eq('user_id', user.id)
          if (compressed.overTarget) {
            nodeImageWarning = `Featured image could not be shrunk under 1 MB (ended at ${Math.round(compressed.bytes / 1024)} KB).`
          }
        }
      } catch (err) {
        nodeImageWarning = err instanceof Error
          ? `Compression skipped: ${err.message}`
          : 'Compression skipped'
      }
    }

    try {
      // Backdate only applies when we're publishing immediately — a scheduled
      // run owns its own date.
      const nodePublishedAt = scheduledAt || publishAt || new Date().toISOString()
      const nodeResult = await publishNodePost({
        apiUrl: site.node_api_url,
        apiKey: site.secret_token,
        post: {
          title: article.title,
          slug: article.slug || undefined,
          content: article.content,
          excerpt: article.excerpt || undefined,
          metaDescription: article.meta_description || article.yoast_meta_description || undefined,
          featuredImageUrl: nodeImageUrl,
          status: scheduledAt ? 'draft' : 'publish',
          publishedAt: nodePublishedAt,
        },
      })

      await supabase.from('articles').update({
        status: 'published',
        published_at: (!scheduledAt && publishAt) ? publishAt : new Date().toISOString(),
        node_post_id: nodeResult.id,
        node_post_url: nodeResult.url,
        updated_at: new Date().toISOString(),
      }).eq('id', articleId)

      if (logEntry) {
        await supabase.from('publish_logs').update({
          status: 'success',
          node_post_id: nodeResult.id,
          node_post_url: nodeResult.url,
        }).eq('id', logEntry.id)
      }

      return NextResponse.json({
        success: true,
        id: nodeResult.id,
        url: nodeResult.url,
        imageWarning: nodeImageWarning,
      })
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

  try {
    const postStatus = scheduledAt ? 'future' : 'publish'
    // `publishAt` only kicks in for the immediate path; a scheduled post owns
    // its own date. Sent as `dateGmt` so WordPress stops interpreting it in
    // the site's local timezone and stamps the post to the exact instant the
    // caller asked for.
    const wpDateGmt = scheduledAt || (postStatus === 'publish' ? publishAt : undefined)

    // Upload featured image to WordPress if present
    let featuredMediaId: number | undefined
    let imageWarning: string | undefined
    if (article.featured_image_url) {
      try {
        const imgUrl = article.featured_image_url as string

        // Shrink first when compress_on_publish is on. The bytes go straight
        // to uploadMedia so it does not refetch (and lose) them. A
        // compression failure never blocks the publish -- we fall back to
        // the URL-fetch path with a warning surfaced on the response.
        let compressed: ServerCompressionResult | null = null
        if (shouldCompress) {
          try {
            compressed = await compressImageFromUrl(imgUrl)
            if (compressed.overTarget) {
              imageWarning = `Featured image could not be shrunk under 1 MB (ended at ${Math.round(compressed.bytes / 1024)} KB).`
            }
          } catch (cmpErr) {
            imageWarning = cmpErr instanceof Error
              ? `Compression skipped: ${cmpErr.message}`
              : 'Compression skipped'
          }
        }

        // Ext has to match the wire mime -- WordPress rejects a mismatch --
        // so use the compressor's ext when it re-encoded.
        const ext = compressed && !compressed.skipped
          ? `.${compressed.ext}`
          : (imgUrl.includes('.png') ? '.png' : imgUrl.includes('.webp') ? '.webp' : '.jpg')

        featuredMediaId = await uploadMedia({
          siteUrl: site.url,
          username: site.wp_username,
          appPassword: site.wp_app_password,
          imageUrl: imgUrl,
          filename: `${article.slug || article.id}${ext}`,
          bytes: compressed && !compressed.skipped ? compressed.buffer : undefined,
          mime: compressed && !compressed.skipped ? compressed.mime : undefined,
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
        dateGmt: wpDateGmt,
        categories: article.wp_category_id ? [article.wp_category_id] : undefined,
        slug: article.slug || undefined,
        featuredMediaId,
        focusKeyphrase: article.focus_keyphrase || undefined,
        keyphraseSynonyms: article.keyphrase_synonyms || undefined,
        yoastTitle: article.yoast_title || undefined,
        yoastMetaDescription: article.yoast_meta_description || undefined,
      },
    })

    // Update article as published — a backdated publish stamps the row with
    // the chosen instant so the dashboard's "published on" matches WP.
    await supabase.from('articles').update({
      status: 'published',
      published_at: (postStatus === 'publish' && publishAt) ? publishAt : new Date().toISOString(),
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

    if (wpResult.categoryWarning) {
      console.warn(`[publish] article ${articleId}: ${wpResult.categoryWarning}`)
    }

    return NextResponse.json({
      success: true,
      id: wpResult.id,
      url: wpResult.link,
      imageWarning,
      categoryWarning: wpResult.categoryWarning,
      yoastWarning: wpResult.yoastWarning,
      metaWarning: wpResult.metaWarning,
    })
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
