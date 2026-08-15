import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: site } = await supabase
    .from('sites')
    .select('url, wp_username, wp_app_password')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  try {
    const auth = Buffer.from(`${site.wp_username}:${site.wp_app_password}`).toString('base64')
    const res = await fetch(
      `${site.url.replace(/\/$/, '')}/wp-json/wp/v2/categories?per_page=100&orderby=name&order=asc`,
      {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(10000),
      }
    )

    if (!res.ok) {
      return NextResponse.json({ categories: [] })
    }

    const raw = await res.json()
    const categories = raw.map((c: { id: number; name: string; count: number }) => ({
      id: c.id,
      name: c.name,
      count: c.count,
    }))

    return NextResponse.json({ categories })
  } catch {
    return NextResponse.json({ categories: [] })
  }
}
