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

    // What this site is actually being written for, from our own history
    // rather than WordPress's lifetime post counts — a category with a decade
    // of old posts in it is not the one the next article belongs to.
    const { data: recent } = await supabase
      .from('articles')
      .select('wp_category_id')
      .eq('user_id', user.id)
      .eq('site_id', params.id)
      .not('wp_category_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(50)

    const tally = new Map<number, number>()
    for (const row of recent || []) {
      const id = row.wp_category_id as number | null
      if (id === null) continue
      tally.set(id, (tally.get(id) || 0) + 1)
    }

    // Ties go to whichever was used most recently: `recent` is newest first,
    // and a strict `>` keeps the first id to reach a count ahead of later ones.
    const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1])
    const top: number | undefined = ranked[0]?.[0]

    // A category that has since been deleted in WordPress is no suggestion.
    const live = categories.some((c: { id: number }) => c.id === top)
    const suggested_id: number | null = top !== undefined && live ? top : null

    return NextResponse.json({ categories, suggested_id })
  } catch {
    return NextResponse.json({ categories: [] })
  }
}
