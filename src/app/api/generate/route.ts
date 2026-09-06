import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateArticle, generateSEOMeta, fillSeoBlanks, AVAILABLE_MODELS } from '@/lib/openrouter'
import { recordUsage, sumUsage, type UsageInfo, type UsageRecord } from '@/lib/ai-cost'

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

  const resolvedModel = model || settings?.default_model || AVAILABLE_MODELS[0].id

  // Reading the site's brief here rather than trusting the client not to
  // impersonate someone else's knowledge base — RLS on the sites table is what
  // makes this safe to send into the prompt.
  let knowledgeBase = ''
  if (site_id) {
    const { data: site } = await supabase
      .from('sites')
      .select('knowledge_base')
      .eq('id', site_id)
      .eq('user_id', user.id)
      .single()
    knowledgeBase = (site?.knowledge_base || '').trim()
  }

  try {
    const articleCalls: UsageInfo[] = []
    const seoCalls: UsageInfo[] = []

    const articleResult = await generateArticle({
      apiKey,
      model: resolvedModel,
      title,
      keywords,
      instructions,
      knowledgeBase,
      wordCount: 1600,
      onUsage: (u) => articleCalls.push(u),
    })

    // Retry SEO generation up to 3 times — required fields must be non-empty
    let seoMeta = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const candidate = await generateSEOMeta(
          apiKey, resolvedModel, title, articleResult.content, keywords,
          (u) => seoCalls.push(u),
        )
        // Accept as soon as all key fields are present
        if (candidate.focusKeyphrase && candidate.keyphraseSynonyms && candidate.yoastTitle && candidate.slug) {
          seoMeta = candidate
          break
        }
        // If missing fields, merge what we have and retry
        seoMeta = candidate
      } catch {
        // swallow and retry
      }
    }

    // Hard fallback — derive from title/keywords if all retries failed or fields still empty
    // Every Yoast field must be non-empty by the time this response lands —
    // the fallbacks derive from the article being generated so a rescued
    // field still reads as its own, and never as a placeholder.
    seoMeta = fillSeoBlanks(seoMeta, {
      title,
      keywords,
      contentText: articleResult.excerpt || '',
    })

    // A meta description the writer model put in the body was written for this
    // exact article, so prefer it over the separately generated one.
    const lifted = articleResult.extractedMetaDescription
    if (lifted && lifted.length >= 50) {
      seoMeta.yoastMetaDescription = lifted.slice(0, 160)
    }

    const receipt: UsageRecord[] = []
    if (articleCalls.length) {
      const rec = await recordUsage({
        supabase, userId: user.id, step: 'article',
        usage: sumUsage(articleCalls, resolvedModel),
      })
      if (rec) receipt.push(rec)
    }
    if (seoCalls.length) {
      const rec = await recordUsage({
        supabase, userId: user.id, step: 'seo',
        usage: sumUsage(seoCalls, resolvedModel),
      })
      if (rec) receipt.push(rec)
    }

    return NextResponse.json({
      ...articleResult,
      seo: seoMeta,
      usage_ids: receipt.map((r) => r.id),
      receipt,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Generation failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
