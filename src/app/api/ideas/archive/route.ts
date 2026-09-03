import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ARCHIVE_MIGRATION_MESSAGE, isMissingTableError } from '@/lib/idea-archive'
import { ALL_SITES } from '@/lib/site-filter'

/** Lists ideas that were turned down, newest first. */
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const siteId = req.nextUrl.searchParams.get('site_id')

  let query = supabase
    .from('archived_ideas')
    .select('*, sites(id, name)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (siteId && siteId !== ALL_SITES) query = query.eq('site_id', siteId)

  const { data: ideas, error } = await query

  if (error) {
    // The archive listing is the one place that should say the migration is
    // missing out loud: this page has nothing else to show, and "no ideas"
    // would read as "you have never turned one down".
    if (isMissingTableError(error)) {
      return NextResponse.json({ error: ARCHIVE_MIGRATION_MESSAGE }, { status: 503 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ideas: ideas || [] })
}

/**
 * Files a turned-down idea away.
 *
 * Called as the generator asks for the next one, so it must not be able to
 * fail that request: an archive that is not there yet returns `archived: false`
 * rather than an error, and the idea generation carries on.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const siteId = typeof body.site_id === 'string' ? body.site_id : ''

  if (!title) return NextResponse.json({ error: 'The idea has no title' }, { status: 400 })
  if (!siteId) return NextResponse.json({ error: 'The idea has no site' }, { status: 400 })

  const keywords = Array.isArray(body.keywords)
    ? body.keywords.filter((k: unknown): k is string => typeof k === 'string').slice(0, 10)
    : []

  // Turning down the same title twice files one idea, not two — hence the
  // unique index and this upsert on it rather than a plain insert.
  const { data: idea, error } = await supabase
    .from('archived_ideas')
    .upsert(
      {
        user_id: user.id,
        site_id: siteId,
        title,
        description: typeof body.description === 'string' ? body.description : null,
        keywords,
        usage_id: typeof body.usage_id === 'string' ? body.usage_id : null,
      },
      { onConflict: 'site_id,title', ignoreDuplicates: true }
    )
    .select()
    .maybeSingle()

  if (error) {
    if (isMissingTableError(error)) return NextResponse.json({ archived: false })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ archived: true, idea }, { status: 201 })
}
