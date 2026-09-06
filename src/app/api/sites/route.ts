import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { testWordPressConnection, getAuthors } from '@/lib/wordpress'
import { testNodeConnection } from '@/lib/nodejs-site'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: sites, error } = await supabase
    .rpc('get_user_sites_ordered', { uid: user.id })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ sites })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  if (body.site_type === 'other') {
    const { name, url } = body

    if (!name || !url) {
      return NextResponse.json({ error: 'Name and URL are required' }, { status: 400 })
    }

    const { data: site, error } = await supabase.from('sites').insert({
      user_id: user.id,
      name,
      url: url.replace(/\/$/, ''),
      site_type: 'other',
      status: 'connected',
      plugin_installed: false,
    }).select().single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ site }, { status: 201 })
  }

  if (body.site_type === 'nodejs') {
    const { name, node_api_url } = body

    if (!name || !node_api_url) {
      return NextResponse.json({ error: 'Name and API URL are required' }, { status: 400 })
    }

    const { data: site, error } = await supabase.from('sites').insert({
      user_id: user.id,
      name,
      url: node_api_url.replace(/\/$/, ''),
      site_type: 'nodejs',
      node_api_url: node_api_url.replace(/\/$/, ''),
      status: 'disconnected',
      plugin_installed: false,
    }).select().single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const test = await testNodeConnection({ apiUrl: site.node_api_url, apiKey: site.secret_token })

    if (test.success) {
      await supabase.from('sites').update({
        status: 'connected',
        last_sync: new Date().toISOString(),
      }).eq('id', site.id)
      site.status = 'connected'
      site.last_sync = new Date().toISOString()
    }

    return NextResponse.json({ site, testError: test.success ? undefined : test.error }, { status: 201 })
  }

  const { name, url, wp_username, wp_app_password } = body

  if (!name || !url || !wp_username || !wp_app_password) {
    return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
  }

  const test = await testWordPressConnection({ siteUrl: url, username: wp_username, appPassword: wp_app_password })

  let authors: { id: number; name: string }[] = []
  let defaultAuthorId: number | null = null
  if (test.success) {
    authors = await getAuthors({ siteUrl: url, username: wp_username, appPassword: wp_app_password })
    const defaultAuthor = authors.find((a) => a.name.toLowerCase() === wp_username.toLowerCase())
    defaultAuthorId = defaultAuthor?.id ?? null
  }

  const { data: site, error } = await supabase.from('sites').insert({
    user_id: user.id,
    name,
    url: url.replace(/\/$/, ''),
    site_type: 'wordpress',
    wp_username,
    wp_app_password,
    wp_authors: authors,
    wp_default_author_id: defaultAuthorId,
    status: test.success ? 'connected' : 'error',
    last_sync: test.success ? new Date().toISOString() : null,
    plugin_installed: false,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!test.success) {
    return NextResponse.json(
      { error: test.error || 'Could not connect to WordPress', site },
      { status: 422 }
    )
  }

  return NextResponse.json({ site }, { status: 201 })
}
