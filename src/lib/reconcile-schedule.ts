import type { createClient } from '@/lib/supabase/server'
import { getPost } from '@/lib/wordpress'

type Supabase = ReturnType<typeof createClient>

/**
 * A scheduled article lives on WordPress as a `future` post, and WordPress —
 * not this app — is what publishes it when the slot fires. Nothing calls back
 * when that happens, so our row keeps saying `scheduled` while the article is
 * already live on the site, and it sits in the Scheduled list forever.
 *
 * This sweep closes that gap: for every article whose slot has passed, ask
 * WordPress what the post actually is, and record the truth. That is what moves
 * a row out of Scheduled and into Published.
 */

/** Cap on posts read per sweep, so a long backlog cannot hammer a site. */
const MAX_CHECKS = 60
/** Parallel reads against the WordPress REST API. */
const CONCURRENCY = 5

interface DueArticle {
  id: string
  scheduled_at: string | null
  wp_post_id: number | null
  sites: {
    name: string | null
    url: string
    wp_username: string
    wp_app_password: string
  } | null
}

export interface ReconcileResult {
  /** Articles whose slot had passed, so we asked WordPress about them. */
  checked: number
  /** Articles WordPress had published — now moved to Published. */
  moved: number
  /** Sites we could not read. Their rows were left exactly as they were. */
  unreachable: string[]
}

export async function reconcileScheduled({
  supabase,
  userId,
  siteId,
}: {
  supabase: Supabase
  userId: string
  /** Limit the sweep to one site; omit for every site the user owns. */
  siteId?: string | null
}): Promise<ReconcileResult> {
  let query = supabase
    .from('articles')
    .select('id, scheduled_at, wp_post_id, sites(name, url, wp_username, wp_app_password)')
    .eq('user_id', userId)
    .eq('status', 'scheduled')
    // Archived articles show on neither list, so correcting them changes
    // nothing the user can see — not worth a WordPress round trip.
    .is('archived_at', null)
    // No post on WordPress means nothing could have gone out.
    .not('wp_post_id', 'is', null)
    // Only slots that have come and gone can have published.
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(MAX_CHECKS)

  if (siteId) query = query.eq('site_id', siteId)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const due = ((data ?? []) as unknown as DueArticle[]).filter(
    (a) => a.wp_post_id && a.sites?.url
  )

  const result: ReconcileResult = { checked: due.length, moved: 0, unreachable: [] }
  const unreachable = new Set<string>()

  await pool(due, CONCURRENCY, async (article) => {
    const site = article.sites!
    let live
    try {
      live = await getPost({
        siteUrl: site.url,
        username: site.wp_username,
        appPassword: site.wp_app_password,
        postId: article.wp_post_id!,
      })
    } catch {
      // Fail safe. An unreadable site tells us nothing about the post, and
      // guessing here would either hide a queued article or claim an unpublished
      // one went out. Leave the row untouched and say which site went quiet.
      unreachable.add(site.name || site.url)
      return
    }

    // `future` means still queued; `draft` means paused, archived, or pulled
    // back on the WordPress side. Neither is published.
    if (live.status !== 'publish') return

    const updates: Record<string, unknown> = {
      status: 'published',
      // Prefer the moment WordPress recorded over the moment we noticed.
      published_at: live.dateGmt || article.scheduled_at || new Date().toISOString(),
      // A live post is not being held back by anything.
      is_paused: false,
      updated_at: new Date().toISOString(),
    }
    // `scheduled_at` is deliberately kept — it is the slot this went out on, and
    // it is what the Published row would otherwise lose.
    if (live.link) updates.wp_post_url = live.link

    const { error: writeError } = await supabase
      .from('articles')
      .update(updates)
      .eq('id', article.id)
      .eq('user_id', userId)

    if (!writeError) result.moved += 1
  })

  result.unreachable = [...unreachable]
  return result
}

/** Run `worker` over `items` with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      await worker(items[next++])
    }
  })
  await Promise.all(runners)
}
