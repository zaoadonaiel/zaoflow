import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getPost, updatePost } from '@/lib/wordpress'

interface Body {
  scheduled_at?: string      // UTC ISO instant
  scheduled_tz?: string      // HST | PST | CT | EST
  is_paused?: boolean
  archived?: boolean
}

/**
 * The row controls on the Schedules page: reschedule, pause/resume, archive.
 *
 * Newly scheduled articles are queued in this app and have no WordPress post
 * until their slot fires, so for them every one of these is a plain write to
 * our own table — which is what makes them editable right up to publication.
 *
 * Articles scheduled the old way already live on WordPress as a `future` post,
 * and WordPress is what publishes those. Every change has to be mirrored there
 * as well: pausing or archiving demotes the WP post to a draft so it cannot go
 * out, and resuming puts it back on the calendar. `wp_post_id` is what tells
 * the two apart.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as Body

  const { data: article } = await supabase
    .from('articles')
    .select('*, sites(url, wp_username, wp_app_password)')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!article) return NextResponse.json({ error: 'Article not found' }, { status: 404 })

  // Resolve the state we are moving to, falling back to what is already stored
  // for anything this request did not mention.
  const paused = 'is_paused' in body ? !!body.is_paused : !!article.is_paused
  const archived = 'archived' in body ? !!body.archived : !!article.archived_at
  const when = body.scheduled_at ?? article.scheduled_at

  if (body.scheduled_at && new Date(body.scheduled_at).getTime() <= Date.now()) {
    return NextResponse.json(
      { error: 'Pick a time in the future — a slot that has already passed publishes immediately.' },
      { status: 400 }
    )
  }

  let wpWarning: string | null = null
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.scheduled_at) {
    updates.scheduled_at = body.scheduled_at
    updates.status = 'scheduled'
  }
  if (body.scheduled_tz) updates.scheduled_tz = body.scheduled_tz
  if ('is_paused' in body) updates.is_paused = paused
  if ('archived' in body) updates.archived_at = archived ? new Date().toISOString() : null

  // Mirror onto WordPress. Only meaningful once the post exists there and has
  // not already gone live — a published post is not ours to re-schedule.
  const site = (article as Record<string, unknown>).sites as {
    url: string; wp_username: string; wp_app_password: string
  } | null

  // Resuming or restoring something whose slot has already gone by would hand
  // WordPress a past-dated `future` post, which it publishes on the spot. Hold
  // it as a draft instead and say so, rather than firing it off by surprise.
  const slotHasPassed = !!when && new Date(when).getTime() <= Date.now()
  const shouldGoLive = !paused && !archived && !slotHasPassed

  if (!paused && !archived && slotHasPassed) {
    wpWarning = 'That publish time has already passed — the post is held as a draft. Pick a new time with the calendar.'
  }

  if (article.wp_post_id && site && article.status !== 'published') {
    try {
      // Ask WordPress what this post actually is before touching it. Our stored
      // status is only a snapshot from when we handed the post over — once a
      // slot fires, WordPress publishes it and never tells us, so an article can
      // read 'scheduled' here while being live on the site.
      const live = await getPost({
        siteUrl: site.url,
        username: site.wp_username,
        appPassword: site.wp_app_password,
        postId: article.wp_post_id,
      })

      if (live.status === 'publish') {
        // It already went out. Demoting it now would pull a live post off the
        // site, which is never what pause/archive/resume is asking for. Record
        // the truth instead, so the article moves to Published where it belongs.
        updates.status = 'published'
        updates.published_at = live.dateGmt || new Date().toISOString()
        updates.is_paused = false
        delete updates.scheduled_at

        // Archiving stays purely local for a live post — it hides the row here
        // without unpublishing anything.
        if (!archived) {
          wpWarning =
            'WordPress already published this article, so it can no longer be rescheduled. Moved to Published.'
        }
      } else {
        await updatePost({
          siteUrl: site.url,
          username: site.wp_username,
          appPassword: site.wp_app_password,
          postId: article.wp_post_id,
          post: shouldGoLive
            ? { status: 'future', dateGmt: when || undefined }
            : { status: 'draft' },
        })
      }
    } catch (err) {
      // Fail safe: if WordPress cannot be reached we do NOT guess. Leaving the
      // post alone risks a pause not taking effect, which is recoverable;
      // guessing risks unpublishing live content, which is not.
      wpWarning =
        (err instanceof Error ? err.message : 'WordPress update failed') +
        ' — the WordPress post was left unchanged.'
    }
  }

  const { data: updated, error } = await supabase
    .from('articles')
    .update(updates)
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select('*, sites(name, url)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ article: updated, wpWarning })
}
