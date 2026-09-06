import { NextRequest, NextResponse } from 'next/server'
import { tasks } from '@trigger.dev/sdk/v3'
import { createClient } from '@/lib/supabase/server'
import { AVAILABLE_MODELS } from '@/lib/openrouter'
import type { generateArticleTask } from '@/trigger/generate-article'

/**
 * Manual "Generate with AI" no longer runs the write inline. The row is
 * pinned to disk as status='generating' before the task is enqueued so the
 * browser closing (or the network dropping) does not lose the work — the
 * task finishes in the cloud and rewrites the same row to 'draft'.
 *
 * Response is { articleId, runId, publicAccessToken, status }. The client
 * uses articleId to bind the form to the new row (with a URL replace) and
 * uses runId + publicAccessToken to subscribe to progress in realtime.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: settings } = await supabase
    .from('api_settings')
    .select('openrouter_api_key, default_model')
    .eq('user_id', user.id)
    .single()

  const apiKey = settings?.openrouter_api_key
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OpenRouter API key not set. Add it in Settings.' },
      { status: 422 }
    )
  }

  const body = await req.json()
  const { title, keywords = [], instructions, model, site_id, article_id } = body

  if (!title?.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  if (!site_id) return NextResponse.json({ error: 'Site is required' }, { status: 400 })

  const resolvedModel = model || settings?.default_model || AVAILABLE_MODELS[0].id

  // Reading the site's brief here rather than trusting the client not to
  // impersonate someone else's knowledge base — RLS on the sites table is
  // what makes this safe to hand off into the task payload.
  const { data: site } = await supabase
    .from('sites')
    .select('knowledge_base')
    .eq('id', site_id)
    .eq('user_id', user.id)
    .single()
  const knowledgeBase = (site?.knowledge_base || '').trim()

  // The row is either the one the client already has (an autosave that
  // preceded generation, or an edit-mode article) or a fresh one we mint
  // here. Either way it lives as 'generating' from the moment the task is
  // enqueued so the article list can show it in-flight.
  let articleId: string
  if (article_id) {
    const { error } = await supabase.from('articles').update({
      title,
      keywords,
      ai_model: resolvedModel,
      status: 'generating',
      updated_at: new Date().toISOString(),
    }).eq('id', article_id).eq('user_id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    articleId = article_id
  } else {
    const { data: created, error } = await supabase.from('articles').insert({
      user_id: user.id,
      site_id,
      title,
      keywords,
      ai_model: resolvedModel,
      status: 'generating',
    }).select('id').single()
    if (error || !created) {
      return NextResponse.json({ error: error?.message || 'Could not create draft' }, { status: 500 })
    }
    articleId = created.id
  }

  // Handoff to Trigger.dev. Importing the task instance directly is the
  // wrong pattern for backend code — the type-only import + tasks.trigger
  // is what keeps this file from pulling the whole task graph into the
  // Next.js bundle.
  const handle = await tasks.trigger<typeof generateArticleTask>('generate-article', {
    articleId,
    userId: user.id,
    siteId: site_id,
    title,
    keywords,
    instructions,
    model: resolvedModel,
    apiKey,
    knowledgeBase,
  })

  // Remember which run wrote the article so a reopen of the row can find
  // the run again (for status polling or realtime resubscription).
  await supabase.from('articles').update({
    trigger_job_id: handle.id,
  }).eq('id', articleId).eq('user_id', user.id)

  return NextResponse.json({
    articleId,
    runId: handle.id,
    publicAccessToken: handle.publicAccessToken,
    status: 'generating',
  })
}
