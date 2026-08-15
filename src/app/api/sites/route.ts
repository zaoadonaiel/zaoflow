import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { testWordPressConnection } from '@/lib/wordpress'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: sites, error } = await supabase
    .from('sites')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ sites })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { name, url, wp_username, wp_app_password } = body

  if (!name || !url || !wp_username || !wp_app_password) {
    return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
  }

  // Test connection before saving
  const test = await testWordPressConnection({ siteUrl: url, username: wp_username, appPassword: wp_app_password })

  const { data: site, error } = await supabase.from('sites').insert({
    user_id: user.id,
    name,
    url: url.replace(/\/$/, ''),
    wp_username,
    wp_app_password,
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
