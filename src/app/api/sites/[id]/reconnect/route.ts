import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { testWordPressConnection } from '@/lib/wordpress'

/**
 * Swap in fresh WordPress credentials for a site that is already connected.
 *
 * Deleting and re-adding the site is the obvious way to fix expired credentials,
 * but it orphans every article, schedule and knowledge base hanging off the old
 * row. This updates the credentials on the row in place, so all of that survives.
 */
export async function POST(
  req: NextRequest,
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
    return NextResponse.json(
      { error: 'Only WordPress sites can be reconnected with a username and password' },
      { status: 400 }
    )
  }

  const body = await req.json()
  const wpUsername: string | undefined = body.wp_username?.trim()
  const appPassword: string | undefined = body.wp_app_password
  // The URL is optional — a site that only rotated its credentials keeps the one
  // it already has, and every article already published against it.
  const url: string = (body.url?.trim() || site.url).replace(/\/$/, '')

  if (!wpUsername || !appPassword) {
    return NextResponse.json(
      { error: 'Username and application password are required' },
      { status: 400 }
    )
  }

  // Verify before writing. Saving credentials we could not reach would replace
  // working ones with broken ones and leave no way back to the originals.
  const test = await testWordPressConnection({
    siteUrl: url,
    username: wpUsername,
    appPassword,
  })

  if (!test.success) {
    return NextResponse.json(
      { error: test.error || 'Could not connect to WordPress with those credentials' },
      { status: 422 }
    )
  }

  // Credentials, URL and status only — name, knowledge_base, analytics links and
  // everything referencing this site's id are deliberately left untouched.
  const { data: updated, error } = await supabase
    .from('sites')
    .update({
      url,
      wp_username: wpUsername,
      wp_app_password: appPassword,
      status: 'connected',
      last_sync: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ site: updated, siteName: test.siteName })
}
