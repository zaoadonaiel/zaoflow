import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateAccessCode, generatePortalToken } from '@/lib/portal'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: portals, error } = await supabase
    .from('client_portals')
    .select('*, sites(name, url), portal_opens(count)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Flatten PostgREST's aggregate shape into a plain number for the UI.
  const withCounts = (portals || []).map((p) => {
    const rel = (p as Record<string, unknown>).portal_opens as { count: number }[] | undefined
    const { portal_opens, ...rest } = p as Record<string, unknown>
    void portal_opens
    return { ...rest, open_count: rel?.[0]?.count ?? 0 }
  })

  return NextResponse.json({ portals: withCounts })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { site_id, client_name } = await req.json()
  if (!site_id) return NextResponse.json({ error: 'Pick a site' }, { status: 400 })

  const { data: site } = await supabase
    .from('sites').select('id').eq('id', site_id).eq('user_id', user.id).single()
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  const { data: portal, error } = await supabase
    .from('client_portals')
    .insert({
      user_id: user.id,
      site_id,
      client_name: client_name?.trim() || null,
      token: generatePortalToken(),
      // Generated here, shown only in the dashboard, and given to the client
      // out of band. The link on its own opens nothing without it.
      access_code: generateAccessCode(),
    })
    .select('*, sites(name, url)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ portal }, { status: 201 })
}
