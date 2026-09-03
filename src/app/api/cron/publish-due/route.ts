import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { publishArticle } from '@/lib/publish-article'

/**
 * Publishes what the Flo queue says is due.
 *
 * A scheduled article now waits here rather than sitting on WordPress as a
 * future post, so it stays editable — text, image, category, the lot — right
 * up until this runs. The cost of that is that Flo is what has to fire: if
 * this stops running, nothing goes out.
 *
 * Articles queued the old way still belong to WordPress. They are recognised
 * by already having a wp_post_id, and are left alone here — WordPress
 * publishes them, and the reconcile sweep notices when it has.
 */

export const maxDuration = 300
// Never prerendered: this reads the request's auth header and the live queue,
// and a build-time attempt has neither.
export const dynamic = 'force-dynamic'

/** Publishes per run, so one sweep cannot run past its own time budget. */
const MAX_PER_RUN = 25
/** Parallel publishes. Each one uploads media, so this stays modest. */
const CONCURRENCY = 3
/**
 * How long a due article keeps being retried before it is called failed.
 * Long enough to ride out a site being briefly unreachable, short enough that
 * a genuinely broken one surfaces rather than retrying every five minutes for
 * the rest of the month.
 */
const RETRY_WINDOW_MS = 60 * 60 * 1000

export async function GET(req: NextRequest) {
  // Vercel signs cron requests with CRON_SECRET when it is set. Without this
  // the endpoint is a public "publish everything due" button.
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const supabase = createServiceClient()
  const now = Date.now()

  // No session here, so this runs as the service role across every user. Each
  // publish is still scoped back to the owning user_id.
  const { data, error } = await supabase
    .from('articles')
    .select('id, user_id, scheduled_at')
    .eq('status', 'scheduled')
    .eq('is_paused', false)
    .is('archived_at', null)
    // The discriminator: no WordPress post means this one is ours to publish.
    .is('wp_post_id', null)
    .lte('scheduled_at', new Date(now).toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(MAX_PER_RUN)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const due = data ?? []
  const published: string[] = []
  const retrying: string[] = []
  const failed: { id: string; error: string }[] = []

  await pool(due, CONCURRENCY, async (article) => {
    const result = await publishArticle({
      supabase,
      userId: article.user_id,
      articleId: article.id,
    })

    if (result.success) {
      published.push(article.id)
      return
    }

    // publishArticle left the row on 'publishing'. Decide what it becomes:
    // back in the queue for another go, or failed and visible.
    const slot = article.scheduled_at ? new Date(article.scheduled_at).getTime() : now
    const giveUp = now - slot > RETRY_WINDOW_MS

    await supabase
      .from('articles')
      .update({
        status: giveUp ? 'failed' : 'scheduled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', article.id)

    if (giveUp) {
      failed.push({ id: article.id, error: result.error || 'Publish failed' })
      console.error(`[cron/publish-due] giving up on ${article.id}: ${result.error}`)
    } else {
      retrying.push(article.id)
      console.warn(`[cron/publish-due] will retry ${article.id}: ${result.error}`)
    }
  })

  return NextResponse.json({
    due: due.length,
    published: published.length,
    retrying: retrying.length,
    failed,
  })
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
