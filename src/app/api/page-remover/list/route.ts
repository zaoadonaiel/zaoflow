import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listPosts } from '@/lib/wordpress'

/**
 * List WordPress pages/posts for the Page Remover.
 *
 * Query params:
 *   site_id      — required
 *   kind         — 'page' (default) or 'post'
 *   view         — 'active' (default) or 'trash'
 *   search       — passed to WP as a title/content match
 *   after        — ISO instant, filters items published on or after
 *   before       — ISO instant, filters items published on or before
 */
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const siteId = searchParams.get('site_id')
  const kindParam = searchParams.get('kind')
  const viewParam = searchParams.get('view')
  const search = searchParams.get('search') || undefined
  const after = searchParams.get('after') || undefined
  const before = searchParams.get('before') || undefined

  const resource: 'posts' | 'pages' = kindParam === 'post' ? 'posts' : 'pages'
  const view: 'active' | 'trash' = viewParam === 'trash' ? 'trash' : 'active'
  if (!siteId) return NextResponse.json({ error: 'site_id is required' }, { status: 400 })

  const { data: site } = await supabase
    .from('sites')
    .select('id, site_type, url, wp_username, wp_app_password')
    .eq('id', siteId)
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
    const pages = await listPosts({
      siteUrl: site.url,
      username: site.wp_username,
      appPassword: site.wp_app_password,
      search,
      resource,
      status: view === 'trash' ? 'trash' : 'publish,draft,pending,private,future',
      afterGmt: after,
      beforeGmt: before,
      orderBy: 'date',
    })
    return NextResponse.json({ pages, view, kind: resource })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to reach WordPress'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
