import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { testWordPressConnection, getAuthors } from '@/lib/wordpress'
import { testNodeConnection } from '@/lib/nodejs-site'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Confirm the row is visible under this user's session before deleting.
  // Without this, `.delete()` on a row RLS filters out would return success
  // with zero rows affected — the UI would flash the site away and then have
  // it reappear on the next fetch, which reads as "won't let me delete".
  const { data: existing, error: findErr } = await supabase
    .from('sites')
    .select('id')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 })
  if (!existing) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  // `select()` gives us the deleted rows back so we can prove one was removed.
  // A foreign key blocking the delete — a table that references sites without
  // `on delete cascade`, drift between the migrations and the live schema —
  // surfaces as a Postgres error here; we forward the `details`/`hint` so the
  // caller sees which relationship is pinning the row in place.
  const { data: deleted, error } = await supabase
    .from('sites')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select('id')

  if (error) {
    const extra = (error as { details?: string | null; hint?: string | null }).details
      || (error as { hint?: string | null }).hint
    return NextResponse.json(
      { error: extra ? `${error.message} — ${extra}` : error.message },
      { status: 500 },
    )
  }

  if (!deleted || deleted.length === 0) {
    return NextResponse.json(
      { error: 'The site could not be deleted — the database refused the request without an error.' },
      { status: 500 },
    )
  }

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

  const allowed = ['name', 'url', 'wp_username', 'wp_app_password', 'node_api_url', 'default_tz'] as const
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body && body[key] !== undefined) {
      updates[key] = typeof body[key] === 'string' ? body[key].trim() : body[key]
    }
  }

  if (typeof updates.default_tz === 'string') {
    const allowedZones = ['HST', 'PST', 'MT', 'CT', 'EST']
    if (!allowedZones.includes(updates.default_tz as string)) {
      return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 })
    }
  }

  if (typeof updates.url === 'string') updates.url = (updates.url as string).replace(/\/$/, '')
  if (typeof updates.node_api_url === 'string') {
    updates.node_api_url = (updates.node_api_url as string).replace(/\/$/, '')
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 })
  }

  // Analytics-only sites are promoted to full WordPress once a WP credential pair
  // is supplied and verified — that's how the key-icon flow "adds" credentials.
  const promotingToWordPress =
    site.site_type === 'other' &&
    typeof updates.wp_username === 'string' &&
    typeof updates.wp_app_password === 'string' &&
    (updates.wp_username as string).length > 0 &&
    (updates.wp_app_password as string).length > 0

  // If credentials or their URL context changed, verify before persisting sensitive changes.
  const credentialFields =
    site.site_type === 'nodejs'
      ? ['node_api_url']
      : site.site_type === 'wordpress'
      ? ['url', 'wp_username', 'wp_app_password']
      : []

  const credentialsChanged = credentialFields.some((k) => k in updates)

  if (credentialsChanged || promotingToWordPress) {
    if (site.site_type === 'wordpress' || promotingToWordPress) {
      const siteUrl = (updates.url as string) ?? site.url
      const username = (updates.wp_username as string) ?? site.wp_username
      const appPassword = (updates.wp_app_password as string) ?? site.wp_app_password
      const test = await testWordPressConnection({ siteUrl, username, appPassword })
      if (!test.success) {
        return NextResponse.json({ error: test.error || 'Could not connect' }, { status: 422 })
      }
      updates.status = 'connected'
      updates.last_sync = new Date().toISOString()
      if (promotingToWordPress) {
        updates.site_type = 'wordpress'
        const authors = await getAuthors({ siteUrl, username, appPassword })
        updates.wp_authors = authors
        const defaultAuthor = authors.find((a) => a.name.toLowerCase() === username.toLowerCase())
        updates.wp_default_author_id = defaultAuthor?.id ?? null
      }
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
