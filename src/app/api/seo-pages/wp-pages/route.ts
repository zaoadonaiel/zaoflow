import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listPages, getPage } from '@/lib/wordpress'

/**
 * Two calls in one endpoint:
 *   GET /api/seo-pages/wp-pages?site_id=…                   → list source pages
 *   GET /api/seo-pages/wp-pages?site_id=…&page_id=123       → fetch one page + content
 */
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const siteId = searchParams.get('site_id')
  const pageId = searchParams.get('page_id')
  const search = searchParams.get('search') || undefined
  if (!siteId) return NextResponse.json({ error: 'site_id is required' }, { status: 400 })

  const { data: site } = await supabase
    .from('sites')
    .select('id, site_type, url, wp_username, wp_app_password')
    .eq('id', siteId)
    .eq('user_id', user.id)
    .single()

  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  if (site.site_type !== 'wordpress') {
    return NextResponse.json({ error: 'This endpoint only supports WordPress sites' }, { status: 400 })
  }
  if (!site.wp_username || !site.wp_app_password) {
    return NextResponse.json({ error: 'WordPress credentials missing on this site' }, { status: 400 })
  }

  try {
    if (pageId) {
      const page = await getPage({
        siteUrl: site.url,
        username: site.wp_username,
        appPassword: site.wp_app_password,
        pageId: Number(pageId),
      })
      return NextResponse.json({ page })
    }

    const pages = await listPages({
      siteUrl: site.url,
      username: site.wp_username,
      appPassword: site.wp_app_password,
      search,
    })
    return NextResponse.json({ pages })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to reach WordPress'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
