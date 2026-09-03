import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAuthors } from '@/lib/wordpress'

// Refreshes the author list from WordPress — needed for sites connected
// before author selection existed, and any time WP's user list changes.
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: site } = await supabase
    .from('sites')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  if (site.site_type !== 'wordpress') {
    return NextResponse.json({ error: 'Not a WordPress site' }, { status: 400 })
  }

  const authors = await getAuthors({
    siteUrl: site.url,
    username: site.wp_username,
    appPassword: site.wp_app_password,
  })

  if (authors.length === 0) {
    return NextResponse.json({
      error: 'Could not fetch users from WordPress — check the connection and that the connected account can list users.',
    }, { status: 422 })
  }

  await supabase.from('sites').update({
    wp_authors: authors,
    updated_at: new Date().toISOString(),
  }).eq('id', params.id)

  return NextResponse.json({ authors })
}
