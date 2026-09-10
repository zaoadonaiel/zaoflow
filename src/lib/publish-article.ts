import type { SupabaseClient } from '@supabase/supabase-js'
import { publishPost, uploadMedia, extensionForImageUrl } from './wordpress'
import { publishPost as publishNodePost } from './nodejs-site'
import { compressImageFromUrl, type ServerCompressionResult } from './image-compression-server'
import { storeCompressedToStorage } from './image-compression-storage'

/**
 * Putting one article onto WordPress.
 *
 * Lifted out of the publish route so the scheduler can use it too: a queued
 * article is published by a cron with no session behind it, and duplicating
 * this logic there is how the two paths would drift.
 */

export interface PublishOutcome {
  success: boolean
  wpPostId?: number
  wpPostUrl?: string
  nodePostId?: string
  nodePostUrl?: string
  /** The post went up, but its featured image did not. */
  imageWarning?: string
  /** The post went up, but not in the category asked for. */
  categoryWarning?: string
  error?: string
}

export async function publishArticle({
  supabase,
  userId,
  articleId,
  scheduledAt,
  scheduledTz,
}: {
  // Either the request-scoped client or the service client, depending on
  // whether a person or the scheduler is doing the publishing.
  supabase: SupabaseClient
  userId: string
  articleId: string
  /**
   * Set only when the post should sit on WordPress as a future post. The Flo
   * queue leaves this off and calls at the slot instead, so the article stays
   * editable here right up until it goes out.
   */
  scheduledAt?: string | null
  scheduledTz?: string | null
}): Promise<PublishOutcome> {
  const { data: article } = await supabase
    .from('articles')
    .select('*, sites(*)')
    .eq('id', articleId)
    .eq('user_id', userId)
    .single()

  if (!article) return { success: false, error: 'Article not found' }

  const site = (article as Record<string, unknown>).sites as {
    site_type?: 'wordpress' | 'nodejs' | 'other'
    url: string; wp_username: string; wp_app_password: string
    wp_default_author_id?: number | null
    node_api_url?: string; secret_token?: string
  } | null
  if (!site) return { success: false, error: 'Site not found' }

  await supabase.from('articles').update({ status: 'publishing' }).eq('id', articleId)

  const { data: logEntry } = await supabase.from('publish_logs').insert({
    article_id: articleId,
    site_id: article.site_id,
    user_id: userId,
    status: 'pending',
  }).select().single()

  // Everything after this point may want a compressed featured image. The
  // toggle lives on the article row (default true, see migration 034) so a
  // person can opt out per-post when they need the full resolution. Skipped
  // silently when the column has not been migrated yet -- an older row simply
  // publishes uncompressed, the way it always did.
  const wantsCompression = (article as { compress_on_publish?: boolean }).compress_on_publish !== false
  const shouldCompress = wantsCompression && !!article.featured_image_url

  // Node.js sites have no native future-post scheduling like WordPress does,
  // so they only ever publish immediately — scheduledAt is a WordPress-only
  // concept here and the article editor doesn't offer it for Node.js sites.
  if (site.site_type === 'nodejs') {
    // Node sites fetch the featured URL themselves, so a compressed publish
    // needs the smaller file living somewhere the site can reach -- Supabase
    // storage. The article row is also pointed at the new URL, so a later
    // edit does not silently revert to the pre-compression file.
    let nodeImageUrl = article.featured_image_url || undefined
    let nodeImageWarning: string | undefined
    if (shouldCompress) {
      try {
        const compressed = await compressImageFromUrl(article.featured_image_url as string)
        if (!compressed.skipped) {
          const newUrl = await storeCompressedToStorage(userId, compressed)
          nodeImageUrl = newUrl
          await supabase
            .from('articles')
            .update({ featured_image_url: newUrl })
            .eq('id', articleId)
            .eq('user_id', userId)
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
      const nodeResult = await publishNodePost({
        apiUrl: site.node_api_url!,
        apiKey: site.secret_token!,
        post: {
          title: article.title,
          slug: article.slug || undefined,
          content: article.content,
          excerpt: article.excerpt || undefined,
          metaDescription: article.meta_description || article.yoast_meta_description || undefined,
          featuredImageUrl: nodeImageUrl,
          status: 'publish',
          publishedAt: new Date().toISOString(),
        },
      })

      await supabase.from('articles').update({
        status: 'published',
        published_at: new Date().toISOString(),
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

      return {
        success: true,
        nodePostId: nodeResult.id,
        nodePostUrl: nodeResult.url,
        imageWarning: nodeImageWarning,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Publish failed'

      if (logEntry) {
        await supabase.from('publish_logs').update({
          status: 'failed',
          error_message: message,
        }).eq('id', logEntry.id)
      }

      return { success: false, error: message }
    }
  }

  try {
    let featuredMediaId: number | undefined
    let imageWarning: string | undefined
    if (article.featured_image_url) {
      try {
        const imgUrl = article.featured_image_url as string

        // Shrink first when compress_on_publish is on. The bytes are handed
        // straight to uploadMedia so it does not refetch (and lose) them.
        // A compression failure never blocks the publish -- we fall back to
        // the URL-fetch path with a warning surfaced on the outcome.
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

        // Slug + ext for the WP filename. When we compressed to WebP the ext
        // must match the compressed mime -- WordPress rejects a mismatch --
        // so use the compressor's ext when present.
        const ext = compressed && !compressed.skipped
          ? `.${compressed.ext}`
          : extensionForImageUrl(imgUrl)

        featuredMediaId = await uploadMedia({
          siteUrl: site.url,
          username: site.wp_username,
          appPassword: site.wp_app_password,
          imageUrl: imgUrl,
          filename: `${article.slug || article.id}${ext}`,
          altText: article.featured_image_alt || undefined,
          bytes: compressed && !compressed.skipped ? compressed.buffer : undefined,
          mime: compressed && !compressed.skipped ? compressed.mime : undefined,
        })
      } catch (imgErr) {
        imageWarning = imgErr instanceof Error ? imgErr.message : 'Featured image upload failed'
      }
    }

    const post = {
      title: article.title,
      content: article.content,
      excerpt: article.excerpt || '',
      status: scheduledAt ? 'future' : 'publish',
      dateGmt: scheduledAt || undefined,
      categories: article.wp_category_id ? [article.wp_category_id] : undefined,
      slug: article.slug || undefined,
      featuredMediaId,
      author: site.wp_default_author_id || undefined,
      focusKeyphrase: article.focus_keyphrase || undefined,
      keyphraseSynonyms: article.keyphrase_synonyms || undefined,
      yoastTitle: article.yoast_title || undefined,
      yoastMetaDescription: article.yoast_meta_description || undefined,
    } as const

    const credentials = {
      siteUrl: site.url,
      username: site.wp_username,
      appPassword: site.wp_app_password,
    }

    // Rewrite the post we already put on this site rather than adding another.
    let wpResult
    try {
      wpResult = await publishPost({
        ...credentials,
        post,
        existingPostId: article.wp_post_id || undefined,
      })
    } catch (err) {
      // The post we recorded is no longer on the site — deleted there, or the
      // site was rebuilt. Create a fresh one instead of failing the save.
      if (!(err as { postMissing?: boolean })?.postMissing) throw err
      wpResult = await publishPost({ ...credentials, post })
    }

    await supabase.from('articles').update(
      scheduledAt
        ? {
            status: 'scheduled',
            scheduled_at: scheduledAt,
            scheduled_tz: scheduledTz || null,
            is_paused: false,
            wp_post_id: wpResult.id,
            wp_post_url: wpResult.link,
            updated_at: new Date().toISOString(),
          }
        : {
            status: 'published',
            published_at: new Date().toISOString(),
            wp_post_id: wpResult.id,
            wp_post_url: wpResult.link,
            updated_at: new Date().toISOString(),
          }
    ).eq('id', articleId)

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

    return {
      success: true,
      wpPostId: wpResult.id,
      wpPostUrl: wpResult.link,
      imageWarning,
      categoryWarning: wpResult.categoryWarning,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Publish failed'

    if (logEntry) {
      await supabase.from('publish_logs').update({
        status: 'failed',
        error_message: message,
      }).eq('id', logEntry.id)
    }

    // The caller decides what the row becomes. A person watching a publish
    // wants it marked failed; the scheduler would rather put it back in the
    // queue and try again on the next sweep than fail on one bad minute.
    return { success: false, error: message }
  }
}
