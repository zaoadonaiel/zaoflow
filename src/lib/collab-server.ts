import type { AuthorSide, EventKind } from './collab'

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Writing to the collaboration record: versions and the log.
 *
 * Both sides go through these, so a client edit and a team edit are stored the
 * same way and land in the same log rather than each side keeping its own.
 */

/** The team's name as it should read in a draft label. */
export async function teamName(supabase: any, userId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', userId)
      .single()

    const full = (data?.full_name || '').trim()
    if (full) return full
    // An email is a poor byline but a truthful one; "The Team" at least never
    // claims to be someone.
    const local = (data?.email || '').split('@')[0]
    return local || 'The Team'
  } catch {
    return 'The Team'
  }
}

/**
 * Records something that happened. Best-effort on purpose: the log is a record
 * of the work, and failing to write it must never undo the work.
 */
export async function logEvent(
  supabase: any,
  event: {
    articleId: string
    userId: string
    kind: EventKind
    side: AuthorSide
    actor: string
    detail?: string | null
    portalId?: string | null
  }
): Promise<void> {
  try {
    await supabase.from('article_events').insert({
      article_id: event.articleId,
      user_id: event.userId,
      kind: event.kind,
      side: event.side,
      actor: event.actor,
      detail: event.detail ?? null,
      portal_id: event.portalId ?? null,
    })
  } catch {}
}

/**
 * Saves a version and returns its label.
 *
 * The first time anyone saves a draft, whatever the article held before is
 * banked as the team's Draft 1 first. Without that the original would be the
 * one version nobody could get back to -- it would have been overwritten by
 * the edit that started the collaboration.
 */
export async function saveDraft(
  supabase: any,
  input: {
    articleId: string
    userId: string
    side: AuthorSide
    authorName: string
    title?: string | null
    content: string
    /** The article's content before this edit, for the opening snapshot. */
    previousContent: string
    previousTitle?: string | null
    portalId?: string | null
  }
): Promise<{ number: number; seededOriginal: boolean }> {
  const { data: existing } = await supabase
    .from('article_drafts')
    .select('id, author_side, number')
    .eq('article_id', input.articleId)
    .order('number', { ascending: true })

  const drafts = existing || []
  let seededOriginal = false

  if (!drafts.length && input.previousContent) {
    const original = await teamName(supabase, input.userId)
    const { error } = await supabase.from('article_drafts').insert({
      article_id: input.articleId,
      user_id: input.userId,
      author_side: 'team',
      author_name: original,
      number: 1,
      title: input.previousTitle ?? null,
      content: input.previousContent,
    })
    if (!error) {
      seededOriginal = true
      drafts.push({ id: '', author_side: 'team', number: 1 })
    }
  }

  const nextNumber =
    Math.max(
      0,
      ...drafts
        .filter((d: any) => d.author_side === input.side)
        .map((d: any) => d.number as number)
    ) + 1

  const { error } = await supabase.from('article_drafts').insert({
    article_id: input.articleId,
    user_id: input.userId,
    author_side: input.side,
    author_name: input.authorName,
    number: nextNumber,
    title: input.title ?? null,
    content: input.content,
    portal_id: input.portalId ?? null,
  })

  if (error) throw new Error(error.message)

  return { number: nextNumber, seededOriginal }
}
