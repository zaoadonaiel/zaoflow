import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  rewriteSeoContent,
  VALID_SIMILARITIES,
  type Similarity,
} from '@/lib/seo-rewrite'

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    content,
    model,
    similarity,
    instructions,
    target_city,
    seo_page_id,
  } = body as {
    content?: string
    model?: string
    similarity?: number
    instructions?: string
    target_city?: string
    seo_page_id?: string
  }

  if (!content || !model || similarity === undefined) {
    return NextResponse.json(
      { error: 'content, model and similarity are required' },
      { status: 400 },
    )
  }
  if (!VALID_SIMILARITIES.includes(similarity as Similarity)) {
    return NextResponse.json(
      { error: `similarity must be one of ${VALID_SIMILARITIES.join(', ')}` },
      { status: 400 },
    )
  }

  const { data: settings } = await supabase
    .from('api_settings')
    .select('openrouter_api_key')
    .eq('user_id', user.id)
    .single()

  const apiKey = settings?.openrouter_api_key
  if (!apiKey) {
    return NextResponse.json(
      { error: 'No OpenRouter API key on file. Add one in Settings.' },
      { status: 400 },
    )
  }

  try {
    const result = await rewriteSeoContent({
      apiKey,
      content,
      model,
      similarity: similarity as Similarity,
      instructions,
      targetCity: target_city,
      supabase,
      userId: user.id,
      seoPageId: seo_page_id || null,
    })
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Rewrite failed'
    if (msg.includes('401') || msg.includes('403')) {
      return NextResponse.json({ error: 'Invalid OpenRouter API key. Update it in Settings.' }, { status: 400 })
    }
    if (msg.includes('402')) {
      return NextResponse.json({ error: 'OpenRouter account has no credits.' }, { status: 400 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
