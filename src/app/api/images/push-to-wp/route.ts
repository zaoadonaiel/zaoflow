import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { uploadMedia, extensionForImageUrl } from '@/lib/wordpress'

/**
 * Turn a human title ("IDS Maui Interior Design Latest News") into the shape
 * WordPress wants as a filename ("IDS-Maui-Interior-Design-Latest-News").
 *
 * Case is kept so "IDS" doesn't become "ids" in the URL. Only alphanumerics
 * and hyphens survive — WP will happily accept much more but a strict stem
 * dodges the surprises that come from apostrophes, punctuation and unicode.
 * Length capped to keep the resulting URL sensible.
 */
function filenameStem(text: string | null | undefined, fallback: string): string {
  const cleaned = (text || '')
    .trim()
    .replace(/[^A-Za-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100)
  return cleaned || fallback
}

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
    // Filename + title come from the alt text (or the prompt as a fallback)
    // so a media row in WordPress reads "IDS Maui Interior Design Latest News"
    // rather than "zaoflow-<uuid>". Title is also POSTed explicitly on the
    // follow-up call so WP's own filename sanitiser cannot mangle it.
    const altText = (body.alt || image.prompt || '').trim() || undefined
    const stem = filenameStem(altText, `zaoflow-${image.id}`)
    const filename = `${stem}${ext}`
    // A media title with visible hyphens looks like a filename; replace them
    // with spaces for the WP library, keeping the original casing.
    const title = stem.replace(/-/g, ' ')

    const mediaId = await uploadMedia({
      siteUrl: site.url,
      username: site.wp_username,
      appPassword: site.wp_app_password,
      imageUrl: image.url,
      filename,
      altText,
      title,
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
