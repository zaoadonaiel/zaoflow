import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { deletePost, restorePost } from '@/lib/wordpress'

type Action = 'trash' | 'restore' | 'delete'

interface Body {
  site_id?: string
  page_id?: number
  kind?: 'post' | 'page'
  action?: Action
}

/**
 * Single write endpoint for Page Remover actions:
 *   action = 'trash'    → moves to WP trash (recoverable)
 *   action = 'restore'  → sends a trashed item back to draft
 *   action = 'delete'   → permanently deletes (WP `force=true`)
 *
 * Kept as a POST rather than DELETE so the three flows share one route and
 * one auth block instead of scattering across HTTP verbs.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Body
  const { site_id, page_id, kind, action } = body

  if (!site_id || !page_id || !action) {
    return NextResponse.json(
      { error: 'site_id, page_id and action are all required' },
      { status: 400 },
    )
  }
  if (action !== 'trash' && action !== 'restore' && action !== 'delete') {
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  }

  const resource: 'posts' | 'pages' = kind === 'post' ? 'posts' : 'pages'

  const { data: site } = await supabase
    .from('sites')
    .select('id, site_type, url, wp_username, wp_app_password')
    .eq('id', site_id)
    .eq('user_id', user.id)
    .single()

  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  if (site.site_type !== 'wordpress') {
    return NextResponse.json({ error: 'Page Remover only supports WordPress sites' }, { status: 400 })
  }
  if (!site.wp_username || !site.wp_app_password) {
    return NextResponse.json({ error: 'WordPress credentials missing on this site' }, { status: 400 })
  }

  try {
    if (action === 'trash') {
      await deletePost({
        siteUrl: site.url,
        username: site.wp_username,
        appPassword: site.wp_app_password,
        postId: Number(page_id),
        resource,
        force: false,
      })
      return NextResponse.json({ ok: true, action })
    }
    if (action === 'delete') {
      await deletePost({
        siteUrl: site.url,
        username: site.wp_username,
        appPassword: site.wp_app_password,
        postId: Number(page_id),
        resource,
        force: true,
      })
      return NextResponse.json({ ok: true, action })
    }
    // action === 'restore'
    const result = await restorePost({
      siteUrl: site.url,
      username: site.wp_username,
      appPassword: site.wp_app_password,
      postId: Number(page_id),
      resource,
    })
    return NextResponse.json({ ok: true, action, status: result.status, link: result.link })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'WordPress action failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
