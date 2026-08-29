import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { writeWithOptionalColumn } from '@/lib/optional-columns'
import { deletePost } from '@/lib/wordpress'
import { saveDraft, logEvent, teamName } from '@/lib/collab-server'
import { draftLabel } from '@/lib/collab'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: article, error } = await supabase
    .from('articles')
    .select('*, sites(*)')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (error || !article) return NextResponse.json({ error: 'Article not found' }, { status: 404 })
  return NextResponse.json({ article })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  // Mirrors the insert in POST /api/articles — the editor sends the same payload
  // for an update, so anything missing here would be silently dropped on save.
  const allowedFields = ['title', 'content', 'keywords', 'excerpt', 'meta_description',
    'site_id', 'ai_model', 'status', 'scheduled_at', 'scheduled_tz', 'word_count',
    'wp_post_id', 'wp_post_url', 'wp_category_id',
    'focus_keyphrase', 'keyphrase_synonyms', 'yoast_title', 'yoast_meta_description', 'slug',
    'featured_image_url', 'featured_image_prompt', 'featured_image_alt']

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowedFields) {
    if (key in body) updates[key] = body[key]
  }

  // What the article says now, read before the write so a version can record
  // what this edit replaced.
  const versioning = !body.silent && typeof body.content === 'string'
  const { data: before } = versioning
    ? await supabase
        .from('articles')
        .select('title, content')
        .eq('id', params.id)
        .eq('user_id', user.id)
        .single()
    : { data: null }

  // featured_image_alt ships in migration 020; see the insert in
  // POST /api/articles. A database without it saves the edit minus the alt,
  // rather than rejecting the whole save.
  const { data: article, error } = await writeWithOptionalColumn<Record<string, unknown>>(
    updates,
    'featured_image_alt',
    (payload) => supabase
      .from('articles')
      .update(payload)
      .eq('id', params.id)
      .eq('user_id', user.id)
      .select()
      .single()
  )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (Array.isArray(body.usage_ids) && body.usage_ids.length) {
    await supabase
      .from('ai_usage')
      .update({ article_id: params.id })
      .in('id', body.usage_ids.slice(0, 20))
      .eq('user_id', user.id)
      .is('article_id', null)
  }

  // Internal activity trail. Best-effort: a logging failure must never turn a
  // successful save into an error the user sees.
  //
  // Autosave passes silent, because a trail that records a write every few
  // seconds of typing is not a trail of anything — the edits worth seeing are
  // the ones somebody chose to make.
  let draft: string | null = null

  if (!body.silent) {
    const actor = await teamName(supabase, user.id)

    await logEvent(supabase, {
      articleId: params.id,
      userId: user.id,
      kind: 'edited',
      side: 'team',
      actor,
    })

    // Once an article is being collaborated on, every deliberate team edit is
    // a version too — otherwise the client's drafts would be kept and ours
    // would not, and the thread would show one side rewriting the other with
    // nothing to compare against.
    //
    // Only once it has started: versioning every save on every article would
    // fill the list with drafts nobody asked for.
    if (versioning && before && before.content !== body.content) {
      const { count } = await supabase
        .from('article_drafts')
        .select('id', { count: 'exact', head: true })
        .eq('article_id', params.id)

      if ((count || 0) > 0) {
        try {
          const { number } = await saveDraft(supabase, {
            articleId: params.id,
            userId: user.id,
            side: 'team',
            authorName: actor,
            title: body.title ?? before.title,
            content: body.content,
            previousContent: '',
          })
          draft = draftLabel({ author_name: actor, number })
          await logEvent(supabase, {
            articleId: params.id,
            userId: user.id,
            kind: 'drafted',
            side: 'team',
            actor,
            detail: draft,
          })
        } catch (err) {
          // A version that could not be written must not fail the save the
          // user is watching — the article itself is already stored.
          console.warn('[articles] draft not saved:', err)
        }
      }
    }
  }

  return NextResponse.json({ article, draft })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Load article + site so we can delete from WordPress too
  const { data: article } = await supabase
    .from('articles')
    .select('wp_post_id, sites(url, wp_username, wp_app_password)')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!article) return NextResponse.json({ error: 'Article not found' }, { status: 404 })

  // Delete from WordPress if it was published there
  let wpDeleted = false
  let wpError: string | null = null
  if (article.wp_post_id) {
    const site = (article as Record<string, unknown>).sites as {
      url: string; wp_username: string; wp_app_password: string
    } | null
    if (site) {
      try {
        await deletePost({
          siteUrl: site.url,
          username: site.wp_username,
          appPassword: site.wp_app_password,
          postId: article.wp_post_id,
        })
        wpDeleted = true
      } catch (err) {
        wpError = err instanceof Error ? err.message : 'WordPress delete failed'
      }
    }
  }

  // Delete from DB regardless of WP outcome
  const { error } = await supabase
    .from('articles')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, wpDeleted, wpError })
}
