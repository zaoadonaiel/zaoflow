import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateAccessCode, generatePortalToken } from '@/lib/portal'

/**
 * Toggle a link on/off, rename it, issue a fresh token (revoking the old URL),
 * or issue a fresh access code — which revokes the old code along with every
 * session it opened, and clears a lockout.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if ('is_active' in body) updates.is_active = !!body.is_active
  if ('client_name' in body) updates.client_name = body.client_name?.trim() || null
  // Rotating replaces the URL; anyone holding the old one loses access.
  if (body.rotate) updates.token = generatePortalToken()
  // A new code takes effect at once: open sessions are signed against the code
  // that let them in, so they stop with it. Whoever has the link now needs the
  // new code from you. This is also the only way back in for a link a client
  // locked by missing three times.
  if (body.new_code) {
    updates.access_code = generateAccessCode()
    updates.failed_attempts = 0
  }

  const { data: portal, error } = await supabase
    .from('client_portals')
    .update(updates)
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select('*, sites(name, url)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ portal })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('client_portals')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
