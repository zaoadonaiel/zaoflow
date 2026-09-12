import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Return the (wp_page_id, target_city) pairs for a site's published SEO
 * pages. The Page Remover uses this to know which WP pages were bulk-cloned
 * via Auto Post so it can bucket them into counties by the clean
 * `target_city` label instead of the marketing-heavy WP title.
 *
 * Read-only — writes still go through the Auto Post flow.
 */
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const siteId = searchParams.get('site_id')
  if (!siteId) return NextResponse.json({ error: 'site_id is required' }, { status: 400 })

  // Only pages that made it live to WordPress carry a wp_page_id — drafts
  // and failed publishes are useless here since Page Remover deals with
  // real WP rows.
  const { data, error } = await supabase
    .from('seo_pages')
    .select('wp_page_id, target_city')
    .eq('user_id', user.id)
    .eq('site_id', siteId)
    .not('wp_page_id', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ cityPages: data || [] })
}
