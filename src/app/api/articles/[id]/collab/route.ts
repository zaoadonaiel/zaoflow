import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { saveDraft, logEvent, teamName } from '@/lib/collab-server'
import { draftLabel } from '@/lib/collab'

/**
 * The team's view of an article's collaboration: every version, and the log.
 *
 * The same history the client sees in their portal, read through the
 * dashboard's own session rather than a token.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // The client's approve/pause switch, read here so the team sees the state
  // they cannot set — an article the client left paused is not going out, and
  // that has to be visible from this side rather than only from theirs.
  const { data: article } = await supabase
    .from('articles')
    .select('is_paused, status')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  const { data: drafts, error: draftsError } = await supabase
    .from('article_drafts')
    .select('id, article_id, author_side, author_name, number, title, content, created_at')
    .eq('article_id', params.id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  const { data: events, error: eventsError } = await supabase
    .from('article_events')
    .select('id, kind, side, actor, detail, created_at')
    .eq('article_id', params.id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(300)

  // Say which migration is missing rather than showing an empty history, which
  // reads as "nothing has happened here" — the one thing a log must never lie
  // about.
  const missing = [draftsError, eventsError].find((e) =>
    e && /does not exist|schema cache/i.test(e.message)
  )
  if (missing) {
    return NextResponse.json(
      { error: 'The collaboration tables are missing — run supabase/migrations/018_collab.sql.' },
      { status: 503 }
    )
  }
  if (draftsError || eventsError) {
    return NextResponse.json(
      { error: (draftsError || eventsError)!.message },
      { status: 500 }
    )
  }

  return NextResponse.json({
    drafts: drafts || [],
    events: events || [],
    is_paused: !!article?.is_paused,
    status: article?.status || null,
  })
}

/**
 * Banking the article as a team version, deliberately.
 *
 * Ordinary saves version themselves once a collaboration is under way; this is
 * for starting one — putting a marker down before handing the article over.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: article } = await supabase
    .from('articles')
    .select('id, title, content')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!article) return NextResponse.json({ error: 'Article not found' }, { status: 404 })
  if (!article.content?.trim()) {
    return NextResponse.json({ error: 'There is nothing to save as a version yet.' }, { status: 400 })
  }

  const actor = await teamName(supabase, user.id)

  try {
    const { number } = await saveDraft(supabase, {
      articleId: article.id,
      userId: user.id,
      side: 'team',
      authorName: actor,
      title: article.title,
      content: article.content,
      // Nothing to bank first: this content is what would have been banked.
      previousContent: '',
    })

    const label = draftLabel({ author_name: actor, number })
    await logEvent(supabase, {
      articleId: article.id,
      userId: user.id,
      kind: 'drafted',
      side: 'team',
      actor,
      detail: label,
    })

    return NextResponse.json({ draft: label, number }, { status: 201 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not save the version' },
      { status: 500 }
    )
  }
}
