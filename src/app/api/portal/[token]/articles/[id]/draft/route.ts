import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requirePortalSession } from '@/lib/portal-session'
import { saveDraft, logEvent } from '@/lib/collab-server'
import { draftLabel } from '@/lib/collab'

/** A whole article, not a comment box. Generous, but not unbounded. */
const MAX_CONTENT = 400_000

/**
 * The client editing the article from their portal.
 *
 * Their edit becomes the article, and both what it was and what it became are
 * kept as versions. Nothing is overwritten in a way that cannot be read back:
 * the first save banks the team's original as Draft 1 before writing anything.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string; id: string } }
) {
  // The access code, not the link, is what opens this. Everything below runs on
  // the service-role client, so the gate has to come first.
  const gate = await requirePortalSession(params.token)
  if (gate) return gate

  const supabase = createServiceClient()
  const { content, title } = await req.json().catch(() => ({}))

  if (typeof content !== 'string' || !content.trim()) {
    return NextResponse.json({ error: 'The article cannot be empty.' }, { status: 400 })
  }
  if (content.length > MAX_CONTENT) {
    return NextResponse.json({ error: 'That article is too long to save.' }, { status: 400 })
  }

  const { data: portal, error: portalError } = await supabase
    .from('client_portals')
    .select('id, user_id, site_id, client_name, is_active')
    .eq('token', params.token)
    .single()

  if (portalError && portalError.code !== 'PGRST116') {
    console.error('[portal] draft portal lookup failed:', portalError)
    return NextResponse.json({ error: 'Your changes could not be saved.' }, { status: 500 })
  }
  if (!portal || !portal.is_active) {
    return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })
  }

  // Scoped to the portal's own site, or the token would be a licence to edit
  // any article whose id could be guessed.
  const { data: article } = await supabase
    .from('articles')
    .select('id, title, content, status')
    .eq('id', params.id)
    .eq('site_id', portal.site_id)
    .single()

  if (!article) return NextResponse.json({ error: 'Article not found.' }, { status: 404 })
  if (article.status !== 'scheduled') {
    return NextResponse.json(
      { error: 'This article has already been published, so it can no longer be edited.' },
      { status: 400 }
    )
  }

  const authorName = portal.client_name || 'Client'

  let number: number
  try {
    const saved = await saveDraft(supabase, {
      articleId: article.id,
      userId: portal.user_id,
      side: 'client',
      authorName,
      title: typeof title === 'string' ? title : article.title,
      content,
      previousContent: article.content || '',
      previousTitle: article.title,
      portalId: portal.id,
    })
    number = saved.number
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Your changes could not be saved.' },
      { status: 500 }
    )
  }

  // The newest draft is the article. Older ones stay readable beside it.
  const { error: updateError } = await supabase
    .from('articles')
    .update({ content, updated_at: new Date().toISOString() })
    .eq('id', article.id)

  if (updateError) {
    return NextResponse.json(
      { error: 'The version was saved but the article could not be updated. Refresh and check.' },
      { status: 500 }
    )
  }

  const label = draftLabel({ author_name: authorName, number })
  await logEvent(supabase, {
    articleId: article.id,
    userId: portal.user_id,
    kind: 'drafted',
    side: 'client',
    actor: authorName,
    detail: label,
    portalId: portal.id,
  })

  return NextResponse.json({ draft: label, number }, { status: 201 })
}
