import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  generateSEOMeta, finaliseSeoMeta, isSeoComplete, AVAILABLE_MODELS,
} from '@/lib/openrouter'
import { recordUsage, sumUsage, type UsageInfo } from '@/lib/ai-cost'

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

  const seoCalls: UsageInfo[] = []

  try {
    // A meta description was never part of what counted as complete here, so a
    // model that returned four fields and an empty fifth was accepted and the
    // Yoast box stayed blank. It counts now.
    let candidate = null
    for (let attempt = 0; attempt < 3 && !isSeoComplete(candidate); attempt++) {
      try {
        candidate = await generateSEOMeta(
          apiKey, resolvedModel, title, content, keywords, (u) => seoCalls.push(u)
        )
      } catch {
        // swallow and retry
      }
    }

    const seoMeta = finaliseSeoMeta(candidate, {
      title,
      keywords,
      articleText: content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    })

    const usageId = seoCalls.length
      ? await recordUsage({
          supabase, userId: user.id, step: 'seo',
          usage: sumUsage(seoCalls, resolvedModel),
        })
      : null

    return NextResponse.json({ seo: seoMeta, usage_ids: usageId ? [usageId] : [] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'SEO generation failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
