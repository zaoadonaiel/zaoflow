import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { testWordPressConnection } from '@/lib/wordpress'
import { testNodeConnection } from '@/lib/nodejs-site'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('sites')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  const { data: site } = await supabase
    .from('sites')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  const allowed = ['name', 'url', 'wp_username', 'wp_app_password', 'node_api_url'] as const
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body && body[key] !== undefined) {
      updates[key] = typeof body[key] === 'string' ? body[key].trim() : body[key]
    }
  }

  if (typeof updates.url === 'string') updates.url = (updates.url as string).replace(/\/$/, '')
  if (typeof updates.node_api_url === 'string') {
    updates.node_api_url = (updates.node_api_url as string).replace(/\/$/, '')
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 })
  }

  // If credentials or their URL context changed, verify before persisting sensitive changes.
  const credentialFields =
    site.site_type === 'nodejs'
      ? ['node_api_url']
      : site.site_type === 'wordpress'
      ? ['url', 'wp_username', 'wp_app_password']
      : []

  const credentialsChanged = credentialFields.some((k) => k in updates)

  if (credentialsChanged) {
    if (site.site_type === 'wordpress') {
      const test = await testWordPressConnection({
        siteUrl: (updates.url as string) ?? site.url,
        username: (updates.wp_username as string) ?? site.wp_username,
        appPassword: (updates.wp_app_password as string) ?? site.wp_app_password,
      })
      if (!test.success) {
        return NextResponse.json({ error: test.error || 'Could not connect' }, { status: 422 })
      }
      updates.status = 'connected'
      updates.last_sync = new Date().toISOString()
    } else if (site.site_type === 'nodejs') {
      const test = await testNodeConnection({
        apiUrl: (updates.node_api_url as string) ?? site.node_api_url,
        apiKey: site.secret_token,
      })
      if (!test.success) {
        return NextResponse.json({ error: test.error || 'Could not connect' }, { status: 422 })
      }
      updates.status = 'connected'
      updates.last_sync = new Date().toISOString()
      // Keep url in sync with node_api_url for display consistency
      if ('node_api_url' in updates) updates.url = updates.node_api_url
    }
  }

  updates.updated_at = new Date().toISOString()

  const { data: updated, error } = await supabase
    .from('sites')
    .update(updates)
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ site: updated })
}
