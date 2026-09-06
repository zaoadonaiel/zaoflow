import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { uploadMedia, extensionForImageUrl } from '@/lib/wordpress'

/**
 * Push a generated image into a WordPress site's media library.
 *
 * The image has to already exist in this user's generated_images table — we
 * do not accept an arbitrary URL, both to keep the operation scoped to the
 * user's own library and to give us a filename and prompt to use for the alt.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    image_url?: string
    site_id?: string
    alt?: string
  }
  const imageUrl = (body.image_url || '').trim()
  const siteId = (body.site_id || '').trim()

  if (!imageUrl || !siteId) {
    return NextResponse.json({ error: 'image_url and site_id are required' }, { status: 400 })
  }

  // Ownership: only images this user has generated can be sent, so a URL
  // that happens to sit on our bucket cannot be pushed by anyone who guessed it.
  const { data: image, error: imgErr } = await supabase
    .from('generated_images')
    .select('id, prompt, url, storage_path')
    .eq('user_id', user.id)
    .eq('url', imageUrl)
    .maybeSingle()

  if (imgErr || !image) {
    return NextResponse.json({ error: 'Image not found in your library' }, { status: 404 })
  }

  // WordPress-only for now: nodejs sites do not carry a media library we can
  // push into, and saying so beats a cryptic upload failure.
  const { data: site, error: siteErr } = await supabase
    .from('sites')
    .select('id, name, url, wp_username, wp_app_password, site_type')
    .eq('id', siteId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (siteErr || !site) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  }
  if (site.site_type && site.site_type !== 'wordpress') {
    return NextResponse.json(
      { error: `${site.name || 'This site'} is not a WordPress site — the media library push only supports WordPress.` },
      { status: 400 },
    )
  }
  if (!site.wp_username || !site.wp_app_password) {
    return NextResponse.json(
      { error: `${site.name || 'This site'} has no WordPress credentials on file.` },
      { status: 400 },
    )
  }

  try {
    const ext = extensionForImageUrl(image.url)
    // A stable filename ties the media item back to the library row and keeps
    // WP-side filenames from colliding across pushes of the same image.
    const filename = `zaoflow-${image.id}${ext}`
    const altText = (body.alt || image.prompt || '').trim() || undefined

    const mediaId = await uploadMedia({
      siteUrl: site.url,
      username: site.wp_username,
      appPassword: site.wp_app_password,
      imageUrl: image.url,
      filename,
      altText,
    })

    return NextResponse.json({
      mediaId,
      siteName: site.name,
      siteUrl: site.url,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not send the image to WordPress' },
      { status: 500 },
    )
  }
}
