import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { uploadMedia, updatePost, extensionForImageUrl } from '@/lib/wordpress'
import { writeWithOptionalColumn } from '@/lib/optional-columns'

interface Body {
  /** The image to send, when it is newer than what the row holds. */
  image_url?: string
  alt?: string
}

/**
 * Put a featured image onto an article that is already live.
 *
 * Republishing would do this too, but it rewrites the whole post — title,
 * body, SEO — and anything edited on WordPress since would be overwritten by
 * our copy. Forgetting the image is not a reason to risk that, so this sends
 * the image and nothing else: upload the file, point the post at it, leave
 * every other field alone.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Body

  const { data: article } = await supabase
    .from('articles')
    .select('*, sites(url, wp_username, wp_app_password)')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!article) return NextResponse.json({ error: 'Article not found' }, { status: 404 })

  const site = (article as Record<string, unknown>).sites as {
    url: string; wp_username: string; wp_app_password: string
  } | null
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  if (!article.wp_post_id) {
    return NextResponse.json(
      { error: 'This article is not on WordPress yet — publish it first.' },
      { status: 400 }
    )
  }

  // The form may hold an image generated a moment ago that the row has not
  // caught up with, so what it sends wins over what is stored.
  const imageUrl = (body.image_url || article.featured_image_url || '').trim()
  const alt = (body.alt ?? article.featured_image_alt ?? '').trim()

  if (!imageUrl) {
    return NextResponse.json(
      { error: 'This article has no featured image to send. Generate one first.' },
      { status: 400 }
    )
  }

  try {
    const ext = extensionForImageUrl(imageUrl)
    const mediaId = await uploadMedia({
      siteUrl: site.url,
      username: site.wp_username,
      appPassword: site.wp_app_password,
      imageUrl,
      filename: `${article.slug || article.id}${ext}`,
      altText: alt || undefined,
    })

    const wpResult = await updatePost({
      siteUrl: site.url,
      username: site.wp_username,
      appPassword: site.wp_app_password,
      postId: article.wp_post_id,
      post: { featuredMediaId: mediaId },
    })

    // Keep the row honest about what the live post is showing, including an
    // image that was only in the form until now.
    // featured_image_alt ships in migration 020. Named directly, a database
    // without it would fail this whole update -- and the url would be lost
    // with the alt, leaving the row denying an image the post is showing.
    await writeWithOptionalColumn(
      {
        featured_image_url: imageUrl,
        featured_image_alt: alt || null,
        updated_at: new Date().toISOString(),
      },
      'featured_image_alt',
      (payload) => supabase
        .from('articles')
        .update(payload)
        .eq('id', params.id)
        .eq('user_id', user.id)
    )

    return NextResponse.json({ mediaId, wpPostUrl: wpResult.link })
  } catch (err) {
    // A post that is no longer there cannot be given an image, and saying so
    // beats a raw 404 from WordPress.
    if ((err as { postMissing?: boolean })?.postMissing) {
      return NextResponse.json(
        { error: 'That post is no longer on WordPress. Republish the article to recreate it.' },
        { status: 409 }
      )
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not send the image to WordPress' },
      { status: 500 }
    )
  }
}
