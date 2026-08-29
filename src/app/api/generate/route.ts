import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  generateArticle, generateSEOMeta, finaliseSeoMeta, isSeoComplete, AVAILABLE_MODELS,
} from '@/lib/openrouter'
import { recordUsage, sumUsage, type UsageInfo } from '@/lib/ai-cost'
import { isNoRowsError } from '@/lib/knowledge-base'

export const maxDuration = 300

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
  const { title, keywords = [], instructions, model, site_id } = body

  if (!title?.trim()) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }
  if (!site_id) {
    return NextResponse.json({ error: 'Pick a site first' }, { status: 400 })
  }

  // Read on the server rather than taken from the request, so the knowledge
  // base the article is written against is always the one actually saved on
  // the site — no client can write around it.
  //
  // select('*') rather than naming knowledge_base: before migration 015 has
  // run, naming the column fails the query and takes article generation down
  // with it. Absent instead means the article is written without one.
  const { data: site, error: siteError } = await supabase
    .from('sites')
    .select('*')
    .eq('id', site_id)
    .eq('user_id', user.id)
    .single()

  if (siteError && !isNoRowsError(siteError)) {
    return NextResponse.json({ error: siteError.message }, { status: 500 })
  }
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  const resolvedModel = model || settings?.default_model || AVAILABLE_MODELS[0].id

  // Kept apart so the article and its SEO pass show as separate line items.
  const articleCalls: UsageInfo[] = []
  const seoCalls: UsageInfo[] = []

  try {
    const articleResult = await generateArticle({
      apiKey,
      model: resolvedModel,
      title,
      keywords,
      instructions,
      knowledgeBase: site.knowledge_base || '',
      wordCount: 1600,
      onUsage: (u) => articleCalls.push(u),
    })

    // The article model is asked for the Yoast fields in the same reply, so a
    // finished article is one request and one charge. The separate SEO pass is
    // now what happens when a model ignores that — not what happens every time.
    let candidate = articleResult.seo

    if (!isSeoComplete(candidate)) {
      for (let attempt = 0; attempt < 2 && !isSeoComplete(candidate); attempt++) {
        try {
          candidate = await generateSEOMeta(
            apiKey, resolvedModel, title, articleResult.content, keywords,
            (u) => seoCalls.push(u)
          )
        } catch {
          // Out of retries is not out of fields — the finaliser below still
          // produces a complete set from the article itself.
        }
      }
    }

    // Whatever came back, held to the lengths Yoast wants, with anything
    // missing derived from the article rather than left for the user to spot.
    const seoMeta = finaliseSeoMeta(candidate, {
      title,
      keywords,
      articleText: articleResult.excerpt || '',
      // A description the writer put in the body was written for this exact
      // article, so it beats anything derived.
      liftedDescription: articleResult.extractedMetaDescription,
    })

    // Recorded even if the SEO pass fell back to derived values — the retries
    // still cost money.
    const usageIds = (
      await Promise.all([
        articleCalls.length
          ? recordUsage({ supabase, userId: user.id, step: 'article', usage: sumUsage(articleCalls, resolvedModel) })
          : null,
        seoCalls.length
          ? recordUsage({ supabase, userId: user.id, step: 'seo', usage: sumUsage(seoCalls, resolvedModel) })
          : null,
      ])
    ).filter(Boolean)

    return NextResponse.json({ ...articleResult, seo: seoMeta, usage_ids: usageIds })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Generation failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
