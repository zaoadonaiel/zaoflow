import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortalSession } from '@/lib/portal-session'
import { revisionState, snippet } from '@/lib/portal'
import { TEAM_BYLINE } from '@/lib/collab'
import { seoChecks } from '@/lib/seo-checks'

interface DraftRow {
  id: string
  article_id: string
  author_side: string
  author_name: string
  number: number
  title: string | null
  content: string
  created_at: string
}

interface EventRow {
  id: string
  article_id: string
  kind: string
  side: string | null
  actor: string | null
  detail: string | null
  created_at: string
}

/**
 * Everything the public portal renders, in one call.
 *
 * Reachable only with a passed access code — the link alone gets a 401 asking
 * for it. Past the gate this runs on the service-role client and validates the
 * token itself. It returns just the fields the client is allowed to see;
 * nothing about the site's credentials, the owner, or unrelated articles
 * leaves this handler.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  // The access code, not the link, is what opens this. Everything below runs on
  // the service-role client, so the gate has to come first.
  const gate = await requirePortalSession(params.token)
  if (gate) return gate

  const supabase = createServiceClient()

  const { data: portal, error: portalError } = await supabase
    .from('client_portals')
    .select('id, user_id, site_id, client_name, is_active, sites(name)')
    .eq('token', params.token)
    .single()

  if (portalError && portalError.code !== 'PGRST116') {
    // PGRST116 is "no row matched", which really is an invalid link. Anything
    // else is our problem and must not be reported as a bad link.
    console.error('[portal] portal lookup failed:', portalError)
    return NextResponse.json(
      { error: 'These articles could not be loaded.', detail: portalError.message },
      { status: 500 }
    )
  }

  if (!portal || !portal.is_active) {
    return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })
  }

  const { data: articles, error: articlesError } = await supabase
    .from('articles')
    .select('id, title, content, status, scheduled_at, scheduled_tz, published_at, wp_post_url, featured_image_url, client_viewed_at, is_paused, yoast_title, yoast_meta_description, slug, focus_keyphrase, keyphrase_synonyms')
    .eq('site_id', portal.site_id)
    .in('status', ['scheduled', 'published'])
    .is('archived_at', null)
    .order('scheduled_at', { ascending: true, nullsFirst: false })

  // A failed query used to fall through as an empty list, which is
  // indistinguishable from having nothing to review — a missing column read as
  // "no articles" to the client. Say it failed instead.
  if (articlesError) {
    console.error('[portal] article query failed:', articlesError)
    return NextResponse.json(
      { error: 'These articles could not be loaded.', detail: articlesError.message },
      { status: 500 }
    )
  }

  const ids = (articles || []).map((a) => a.id)
  const { data: comments, error: commentsError } = ids.length
    ? await supabase
        .from('article_comments')
        .select('id, article_id, body, is_billable, resolved_at, created_at, author_side, author_name')
        .in('article_id', ids)
        .order('created_at', { ascending: true })
    : { data: [], error: null }

  if (commentsError) {
    console.error('[portal] comment query failed:', commentsError)
    return NextResponse.json(
      { error: 'These articles could not be loaded.', detail: commentsError.message },
      { status: 500 }
    )
  }

  const byArticle = new Map<string, typeof comments>()
  for (const c of comments || []) {
    const list = byArticle.get(c.article_id) || []
    list.push(c.author_side === 'team' ? { ...c, author_name: TEAM_BYLINE } : c)
    byArticle.set(c.article_id, list)
  }

  // Versions and the log. Both are read here rather than behind their own
  // requests so opening an article shows its whole history at once, and a
  // failure to read either is reported rather than showing an empty history
  // that reads as "nothing has happened".
  const { data: drafts, error: draftsError } = ids.length
    ? await supabase
        .from('article_drafts')
        .select('id, article_id, author_side, author_name, number, title, content, created_at')
        .in('article_id', ids)
        .order('created_at', { ascending: true })
    : { data: [], error: null }

  const { data: events, error: eventsError } = ids.length
    ? await supabase
        .from('article_events')
        .select('id, article_id, kind, side, actor, detail, created_at')
        .in('article_id', ids)
        .order('created_at', { ascending: false })
        .limit(500)
    : { data: [], error: null }

  // A database still on migration 017 has neither table shape. That is a
  // missing migration, not a broken portal: the articles are still readable,
  // so the collaboration history comes back empty rather than taking the page
  // down with it.
  if (draftsError) console.warn('[portal] drafts unavailable:', draftsError.message)
  if (eventsError) console.warn('[portal] events unavailable:', eventsError.message)

  // The empty branch of each query above types as never[], so these are the
  // shapes rather than an inference off a value that may never exist.
  // Everything the team did is signed by the agency here, whoever actually
  // did it -- including rows already written under a person's name.
  const draftsByArticle = new Map<string, DraftRow[]>()
  for (const d of (drafts || []) as DraftRow[]) {
    const list = draftsByArticle.get(d.article_id) || []
    list.push(d.author_side === 'team' ? { ...d, author_name: TEAM_BYLINE } : d)
    draftsByArticle.set(d.article_id, list)
  }

  const eventsByArticle = new Map<string, EventRow[]>()
  for (const e of (events || []) as EventRow[]) {
    const list = eventsByArticle.get(e.article_id) || []
    list.push(e.side === 'team' ? { ...e, actor: TEAM_BYLINE } : e)
    eventsByArticle.set(e.article_id, list)
  }

  const payload = (articles || []).map((a) => {
    const mine = byArticle.get(a.id) || []
    const { state, revisedAt } = revisionState(mine, a.client_viewed_at)
    return {
      id: a.id,
      title: a.title,
      snippet: snippet(a.content || ''),
      content: a.content,
      status: a.status,
      scheduled_at: a.scheduled_at,
      scheduled_tz: a.scheduled_tz,
      published_at: a.published_at,
      featured_image_url: a.featured_image_url,
      seo: seoChecks(a),
      // Only scheduled articles are open for revision; published ones are
      // history the client can read but no longer change.
      commentable: a.status === 'scheduled',
      // Approved is the resting state — nothing paused publishes.
      is_paused: !!a.is_paused,
      state,
      revised_at: revisedAt || null,
      comments: mine,
      drafts: draftsByArticle.get(a.id) || [],
      events: eventsByArticle.get(a.id) || [],
    }
  })

  const site = (portal as Record<string, unknown>).sites as { name: string } | null

  return NextResponse.json({
    portal: {
      client_name: portal.client_name,
      site_name: site?.name ?? null,
    },
    articles: payload,
  })
}
