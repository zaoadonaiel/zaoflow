import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getPostFull, updatePost } from '@/lib/wordpress'
import {
  parseCity,
  enforceCityDisplayInHtml,
  enforceCityDisplayInText,
} from '@/lib/seo-city-swap'

/**
 * Force every variant of a given city name (slug, lowercase, mixed case,
 * single-letter typos) to its canonical display form on a live WordPress
 * post/page. Slug is left alone — changing a URL would break inbound links —
 * so the fix touches title, excerpt, HTML content and all four Yoast fields.
 *
 * The write path uses the same two-step trick as `publishPost`: the main PUT
 * carries the meta, then a follow-up POST re-sends just the `meta` block
 * because some WP installs silently drop meta from a combined update.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { site_id, page_id, kind, city } = body as {
    site_id?: string
    page_id?: number
    kind?: 'post' | 'page'
    city?: string
  }

  if (!site_id || !page_id || !city?.trim()) {
    return NextResponse.json(
      { error: 'site_id, page_id and city are all required' },
      { status: 400 },
    )
  }

  const resource: 'posts' | 'pages' = kind === 'page' ? 'pages' : 'posts'

  const { data: site } = await supabase
    .from('sites')
    .select('id, site_type, url, wp_username, wp_app_password')
    .eq('id', site_id)
    .eq('user_id', user.id)
    .single()

  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  if (site.site_type !== 'wordpress') {
    return NextResponse.json({ error: 'City fix only supports WordPress sites' }, { status: 400 })
  }
  if (!site.wp_username || !site.wp_app_password) {
    return NextResponse.json({ error: 'WordPress credentials missing on this site' }, { status: 400 })
  }

  let page
  try {
    page = await getPostFull({
      siteUrl: site.url,
      username: site.wp_username,
      appPassword: site.wp_app_password,
      postId: Number(page_id),
      resource,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to read from WordPress' },
      { status: 502 },
    )
  }

  const parsed = parseCity(city)

  const fixed = {
    title: enforceCityDisplayInText(page.title || '', parsed),
    content: enforceCityDisplayInHtml(page.content || '', parsed),
    excerpt: enforceCityDisplayInHtml(page.excerpt || '', parsed),
    yoastTitle: enforceCityDisplayInText(page.yoastTitle || '', parsed),
    yoastMetaDescription: enforceCityDisplayInText(page.yoastMetaDescription || '', parsed),
    focusKeyphrase: enforceCityDisplayInText(page.focusKeyphrase || '', parsed),
    keyphraseSynonyms: enforceCityDisplayInText(page.keyphraseSynonyms || '', parsed),
  }

  const changed = {
    title: fixed.title !== (page.title || ''),
    content: fixed.content !== (page.content || ''),
    excerpt: fixed.excerpt !== (page.excerpt || ''),
    yoastTitle: fixed.yoastTitle !== (page.yoastTitle || ''),
    yoastMetaDescription: fixed.yoastMetaDescription !== (page.yoastMetaDescription || ''),
    focusKeyphrase: fixed.focusKeyphrase !== (page.focusKeyphrase || ''),
    keyphraseSynonyms: fixed.keyphraseSynonyms !== (page.keyphraseSynonyms || ''),
  }

  const anyChanged = Object.values(changed).some(Boolean)
  if (!anyChanged) {
    return NextResponse.json({
      updated: false,
      message: `Nothing to fix — every reference to "${parsed.display}" already matches.`,
    })
  }

  // Build the WP payload. Yoast + `_location` etc. go through the `meta`
  // object; the top-level fields are the WP-native ones.
  const post: Record<string, unknown> = {
    title: fixed.title,
    content: fixed.content,
    excerpt: fixed.excerpt,
  }
  const meta: Record<string, string> = {}
  if (changed.yoastTitle) meta['_yoast_wpseo_title'] = fixed.yoastTitle
  if (changed.yoastMetaDescription) meta['_yoast_wpseo_metadesc'] = fixed.yoastMetaDescription
  if (changed.focusKeyphrase) meta['_yoast_wpseo_focuskw'] = fixed.focusKeyphrase
  if (changed.keyphraseSynonyms) meta['_yoast_wpseo_keywordsynonyms'] = fixed.keyphraseSynonyms
  if (Object.keys(meta).length > 0) post.meta = meta

  try {
    await updatePost({
      siteUrl: site.url,
      username: site.wp_username,
      appPassword: site.wp_app_password,
      postId: page.id,
      post,
      resource,
    })

    // Retry meta on its own — WP silently drops the meta block from combined
    // updates on installs that haven't registered the keys as show_in_rest.
    // Best-effort, matching publishPost's behaviour.
    if (Object.keys(meta).length > 0) {
      try {
        await fetch(`${site.url.replace(/\/$/, '')}/wp-json/wp/v2/${resource}/${page.id}`, {
          method: 'POST',
          headers: {
            Authorization: 'Basic ' + Buffer.from(`${site.wp_username}:${site.wp_app_password}`).toString('base64'),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ meta }),
          signal: AbortSignal.timeout(20000),
        })
      } catch {
        // ignore — the main update already went through
      }
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'WordPress update failed' },
      { status: 502 },
    )
  }

  return NextResponse.json({
    updated: true,
    changed,
    fixed,
    link: page.link,
  })
}
