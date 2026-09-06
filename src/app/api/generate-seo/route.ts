import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateSEOMeta, fillSeoBlanks, AVAILABLE_MODELS } from '@/lib/openrouter'
import { recordUsage, sumUsage, type UsageInfo, type UsageRecord } from '@/lib/ai-cost'

export const maxDuration = 60

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
  const { title, content = '', keywords = [], model } = body

  if (!title?.trim()) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }

  const resolvedModel = model || settings?.default_model || AVAILABLE_MODELS[0].id

  try {
    const seoCalls: UsageInfo[] = []
    let seoMeta = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const candidate = await generateSEOMeta(
          apiKey, resolvedModel, title, content, keywords,
          (u) => seoCalls.push(u),
        )
        if (candidate.focusKeyphrase && candidate.keyphraseSynonyms && candidate.yoastTitle && candidate.slug) {
          seoMeta = candidate
          break
        }
        seoMeta = candidate
      } catch {
        // swallow and retry
      }
    }

    // Every Yoast field must be non-empty by the time this response lands.
    const plainContent = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    seoMeta = fillSeoBlanks(seoMeta, { title, keywords, contentText: plainContent })

    const receipt: UsageRecord[] = []
    if (seoCalls.length) {
      const rec = await recordUsage({
        supabase, userId: user.id, step: 'seo',
        usage: sumUsage(seoCalls, resolvedModel),
      })
      if (rec) receipt.push(rec)
    }

    return NextResponse.json({
      seo: seoMeta,
      usage_ids: receipt.map((r) => r.id),
      receipt,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'SEO generation failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
