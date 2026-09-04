import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { testWordPressConnection } from '@/lib/wordpress'
import { testNodeConnection } from '@/lib/nodejs-site'

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

  const body = await req.json().catch(() => ({} as Record<string, unknown>))

  if (site.site_type === 'wordpress' || site.site_type === 'other') {
    const siteUrl = typeof body.url === 'string' && body.url.trim() ? body.url.trim() : site.url
    const username =
      typeof body.wp_username === 'string' && body.wp_username.trim()
        ? body.wp_username.trim()
        : site.wp_username
    const appPassword =
      typeof body.wp_app_password === 'string' && body.wp_app_password.trim()
        ? body.wp_app_password.trim()
        : site.wp_app_password

    if (!siteUrl || !username || !appPassword) {
      return NextResponse.json(
        { success: false, error: 'URL, username, and app password are all required' },
        { status: 400 }
      )
    }

    const result = await testWordPressConnection({ siteUrl, username, appPassword })
    return NextResponse.json(result)
  }

  if (site.site_type === 'nodejs') {
    const apiUrl =
      typeof body.node_api_url === 'string' && body.node_api_url.trim()
        ? body.node_api_url.trim()
        : site.node_api_url

    if (!apiUrl) {
      return NextResponse.json(
        { success: false, error: 'API URL is required' },
        { status: 400 }
      )
    }

    const result = await testNodeConnection({ apiUrl, apiKey: site.secret_token })
    return NextResponse.json(result)
  }

  return NextResponse.json(
    { success: false, error: 'This site type has no credentials to test' },
    { status: 400 }
  )
}
