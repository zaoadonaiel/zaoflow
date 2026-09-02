import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { testWordPressConnection, getAuthors } from '@/lib/wordpress'

// WordPress redirects here after user approves the Application Password
// Params: site_url, user_login, password (from WordPress) + our own site_name,
// or site_id when an existing site is being reconnected with new credentials.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  const siteUrl   = searchParams.get('site_url')
  const userLogin = searchParams.get('user_login')
  const password  = searchParams.get('password')
  const siteName  = searchParams.get('site_name') || 'My Site'
  const siteId    = searchParams.get('site_id')

  // User rejected the authorization
  if (searchParams.get('error') === 'user_refused') {
    return NextResponse.redirect(`${appUrl}/sites?wp_error=rejected`)
  }

  if (!siteUrl || !userLogin || !password) {
    return NextResponse.redirect(`${appUrl}/sites?wp_error=invalid`)
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(`${appUrl}/login`)
  }

  // Test connection with the received credentials
  const test = await testWordPressConnection({
    siteUrl,
    username: userLogin,
    appPassword: password,
  })

  // Reconnecting an existing site: update the credentials on the row that is
  // already there, so its articles, schedules and knowledge base all survive.
  if (siteId) {
    const { data: existing } = await supabase
      .from('sites')
      .select('id, name, wp_default_author_id')
      .eq('id', siteId)
      .eq('user_id', user.id)
      .single()

    if (!existing) {
      return NextResponse.redirect(`${appUrl}/sites?wp_error=invalid`)
    }

    // Unlike a new site, there are working credentials here worth protecting —
    // never overwrite them with ones that failed their test.
    if (!test.success) {
      return NextResponse.redirect(
        `${appUrl}/sites?wp_error=reconnect_failed&wp_message=${encodeURIComponent(
          test.error || 'WordPress granted access, but the connection test failed.'
        )}`
      )
    }

    // Refresh the author list, but leave an already-chosen default author alone —
    // reconnecting (e.g. because that account's access was revoked) should not
    // silently switch who future posts get attributed to.
    const authors = await getAuthors({ siteUrl, username: userLogin, appPassword: password })
    const keepDefault = authors.some((a) => a.id === existing.wp_default_author_id)

    const { error: updateError } = await supabase
      .from('sites')
      .update({
        url: siteUrl.replace(/\/$/, ''),
        wp_username: userLogin,
        wp_app_password: password,
        wp_authors: authors,
        wp_default_author_id: keepDefault ? existing.wp_default_author_id : null,
        status: 'connected',
        last_sync: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', siteId)
      .eq('user_id', user.id)

    if (updateError) {
      return NextResponse.redirect(`${appUrl}/sites?wp_error=save_failed`)
    }

    return NextResponse.redirect(
      `${appUrl}/sites?wp_reconnected=${encodeURIComponent(existing.name)}`
    )
  }

  // Best-effort — a connection that can't list users still saves and publishes
  // fine, it just has nothing to offer in the author picker yet.
  const authors = test.success
    ? await getAuthors({ siteUrl, username: userLogin, appPassword: password })
    : []
  const defaultAuthor = authors.find((a) => a.name.toLowerCase() === userLogin.toLowerCase())

  const { error } = await supabase.from('sites').insert({
    user_id: user.id,
    name: decodeURIComponent(siteName),
    url: siteUrl.replace(/\/$/, ''),
    wp_username: userLogin,
    wp_app_password: password,
    wp_authors: authors,
    wp_default_author_id: defaultAuthor?.id ?? null,
    status: test.success ? 'connected' : 'error',
    last_sync: test.success ? new Date().toISOString() : null,
    plugin_installed: false,
  })

  if (error) {
    return NextResponse.redirect(`${appUrl}/sites?wp_error=save_failed`)
  }

  // WordPress handed over credentials, so the site is worth keeping — but they do
  // not work yet, and saying "connected successfully" here would be a lie the user
  // only catches later, from a red badge with no reason attached.
  if (!test.success) {
    return NextResponse.redirect(
      `${appUrl}/sites?wp_error=test_failed&wp_message=${encodeURIComponent(
        test.error || 'WordPress granted access, but the connection test failed.'
      )}`
    )
  }

  return NextResponse.redirect(
    `${appUrl}/sites?wp_connected=${encodeURIComponent(decodeURIComponent(siteName))}`
  )
}
