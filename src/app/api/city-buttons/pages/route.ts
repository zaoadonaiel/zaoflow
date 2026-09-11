import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listPosts } from '@/lib/wordpress'

/**
 * List published WordPress pages for the City Buttons generator.
 *
 * Only published pages are returned — the shortcode wires up live-site
 * buttons, so drafts and scheduled pages would surface IDs that render as
 * broken links until they go live.
 */
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const siteId = searchParams.get('site_id')
  if (!siteId) return NextResponse.json({ error: 'site_id is required' }, { status: 400 })

  const { data: site } = await supabase
    .from('sites')
    .select('id, site_type, url, wp_username, wp_app_password')
    .eq('id', siteId)
    .eq('user_id', user.id)
    .single()

  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  if (site.site_type !== 'wordpress') {
    return NextResponse.json({ error: 'City Buttons only supports WordPress sites' }, { status: 400 })
  }
  if (!site.wp_username || !site.wp_app_password) {
    return NextResponse.json({ error: 'WordPress credentials missing on this site' }, { status: 400 })
  }

  try {
    const pages = await listPosts({
      siteUrl: site.url,
      username: site.wp_username,
      appPassword: site.wp_app_password,
      resource: 'pages',
      status: 'publish',
    })
    return NextResponse.json({ pages })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to reach WordPress'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
