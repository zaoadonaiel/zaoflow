import type { SupabaseClient } from '@supabase/supabase-js'
import { updatePost } from '@/lib/wordpress'

/**
 * Rearranging a publishing queue — the one implementation, used by the client
 * portal and by the team's own scheduler.
 *
 * The publication dates are not moved with the articles: they stay exactly
 * where they are, and the articles are dealt onto them in the new order.
 * Thirty articles across thirty days stay on those thirty days; dragging the
 * one due on the 13th to the top gives it the earliest slot and pushes
 * everything it passed one place later. That is what keeps a month's cadence
 * intact no matter how much either side shuffles.
 *
 * It lives here rather than in either route because a reorder made by the
 * client and one made by the team have to mean the same thing — the same
 * dealing, the same staleness guard, the same rollback when WordPress refuses.
 */

/** A sane ceiling on one reorder, well above a year of daily articles. */
export const MAX_ARTICLES = 400

/** A publication date and the zone it was set in. The two travel together. */
export interface Slot {
  at: string
  tz: string | null
}

export interface WpSite {
  url: string
  wp_username: string
  wp_app_password: string
}

/**
 * The little a queued article has to carry to be dealt a new date. Rows must
 * be selected with their site's WordPress credentials joined on, or anything
 * already queued on WordPress cannot be mirrored.
 */
export interface QueuedRow {
  id: string
  scheduled_at: string | null
  scheduled_tz?: string | null
  wp_post_id?: number | null
  sites?: unknown
}

export type ReorderResult =
  /** The ids that actually changed date, so a caller can log what it did. */
  | { ok: true; moved: string[] }
  | { ok: false; status: number; error: string }

/**
 * Whether the list of ids is one we will act on at all — shape only, before
 * anything is looked up.
 */
export function checkOrder(order: unknown): { status: number; error: string } | null {
  if (!Array.isArray(order) || order.length < 2) {
    return { status: 400, error: 'Nothing to reorder.' }
  }
  if (order.length > MAX_ARTICLES) {
    return { status: 400, error: 'That is too many articles to reorder at once.' }
  }
  if (new Set(order).size !== order.length || order.some((id) => typeof id !== 'string')) {
    return { status: 400, error: 'That list of articles is not valid.' }
  }
  return null
}

/**
 * Deals the queue's own dates onto its articles in the given order and writes
 * the result, mirroring anything that already lives on WordPress.
 *
 * `articles` must be exactly the rows the ids name — scheduled, unarchived and
 * still in the future. Anything else means the schedule moved under whoever is
 * dragging, and dealing anyway would put articles on dates that are not theirs.
 */
export async function reorderQueue<T extends QueuedRow>(
  supabase: SupabaseClient,
  articles: T[],
  order: string[]
): Promise<ReorderResult> {
  // If the two no longer line up — something published, was archived, or was
  // rescheduled while the page sat open — stop and ask for a refresh.
  if (articles.length !== order.length) {
    return {
      ok: false,
      status: 409,
      error: 'The schedule changed while this page was open. Refresh and try again.',
    }
  }

  const now = Date.now()
  if (articles.some((a) => !a.scheduled_at || new Date(a.scheduled_at).getTime() <= now)) {
    return {
      ok: false,
      status: 409,
      error: 'One of these articles is already due to publish, so the queue can no longer be reordered.',
    }
  }

  const byId = new Map(articles.map((a) => [a.id, a]))
  if (order.some((id) => !byId.has(id))) {
    return {
      ok: false,
      status: 409,
      error: 'The schedule changed while this page was open. Refresh and try again.',
    }
  }

  // The dates, in the order they will happen. These stay put; the articles move.
  const slots: Slot[] = articles
    .map((a) => ({ at: a.scheduled_at as string, tz: a.scheduled_tz ?? null }))
    .sort((x, y) => x.at.localeCompare(y.at))

  const moves = order
    .map((id, i) => ({ article: byId.get(id)!, slot: slots[i] }))
    .filter(({ article, slot }) =>
      article.scheduled_at !== slot.at || (article.scheduled_tz ?? null) !== slot.tz)

  if (!moves.length) return { ok: true, moved: [] }

  // Articles queued the old way live on WordPress as a `future` post, and
  // WordPress is what publishes those — moving only our row would leave a new
  // date on screen while the old one still fires.
  //
  // Those are updated first, and any failure unwinds the ones already moved and
  // abandons the whole reorder. A half-applied shuffle is the one outcome worth
  // going to real trouble to avoid: it can leave two articles sharing a date.
  const applied: { postId: number; at: string; site: WpSite }[] = []

  for (const { article, slot } of moves) {
    const site = (article as Record<string, unknown>).sites as WpSite | null
    if (!article.wp_post_id || !site) continue

    try {
      await updatePost({
        siteUrl: site.url,
        username: site.wp_username,
        appPassword: site.wp_app_password,
        postId: article.wp_post_id,
        post: { status: 'future', dateGmt: slot.at },
      })
      applied.push({ postId: article.wp_post_id, at: article.scheduled_at as string, site })
    } catch (err) {
      const rolledBack = await unwind(applied)
      return {
        ok: false,
        status: 502,
        error:
          (err instanceof Error ? err.message : 'WordPress could not be updated') +
          (rolledBack
            ? ' — nothing was changed.'
            : ' — and some dates on WordPress could not be put back. Please contact your account manager.'),
      }
    }
  }

  const stamp = new Date().toISOString()
  for (const { article, slot } of moves) {
    const { error } = await supabase
      .from('articles')
      .update({ scheduled_at: slot.at, scheduled_tz: slot.tz, updated_at: stamp })
      .eq('id', article.id)

    if (error) {
      console.error('[reorder] update failed:', error)
      return {
        ok: false,
        status: 500,
        error: 'Some articles were moved, but the rest could not be. Refresh to see where things stand.',
      }
    }
  }

  return { ok: true, moved: moves.map(({ article }) => article.id) }
}

/** Puts WordPress posts back on the dates they had. True if every one went back. */
async function unwind(applied: { postId: number; at: string; site: WpSite }[]): Promise<boolean> {
  let clean = true
  for (const a of applied) {
    try {
      await updatePost({
        siteUrl: a.site.url,
        username: a.site.wp_username,
        appPassword: a.site.wp_app_password,
        postId: a.postId,
        post: { status: 'future', dateGmt: a.at },
      })
    } catch {
      clean = false
    }
  }
  return clean
}
