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

    // "What has this site actually been publishing lately?" beats "what does
    // WordPress hold the most legacy posts in?" — the latter picks up whatever
    // was on the site before Zao Flo started writing to it.
    const { data: recent } = await supabase
      .from('articles')
      .select('wp_category_id')
      .eq('site_id', params.id)
      .eq('user_id', user.id)
      .not('wp_category_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(20)

    let suggested_id: number | null = null
    if (recent?.length) {
      const counts = new Map<number, number>()
      for (const r of recent) {
        const id = r.wp_category_id as number
        counts.set(id, (counts.get(id) ?? 0) + 1)
      }
      suggested_id = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
    }

    return NextResponse.json({ categories, suggested_id })
  } catch {
    return NextResponse.json({ categories: [], suggested_id: null })
  }
}
