import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateSEOMeta, AVAILABLE_MODELS } from '@/lib/openrouter'

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
    let seoMeta = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const candidate = await generateSEOMeta(apiKey, resolvedModel, title, content, keywords)
        if (candidate.focusKeyphrase && candidate.keyphraseSynonyms && candidate.yoastTitle && candidate.slug) {
          seoMeta = candidate
          break
        }
        seoMeta = candidate
      } catch {
        // swallow and retry
      }
    }

    const titleWords = title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean)

    if (!seoMeta) {
      const plainContent = content.replace(/<[^>]+>/g, ' ').trim()
      seoMeta = {
        focusKeyphrase: keywords[0] || titleWords.slice(0, 3).join(' '),
        keyphraseSynonyms: keywords[1] || titleWords.slice(-3).join(' '),
        yoastTitle: title,
        yoastMetaDescription: plainContent.slice(0, 155) || title,
        slug: titleWords.slice(0, 8).join('-').slice(0, 60),
      }
    } else {
      if (!seoMeta.focusKeyphrase) seoMeta.focusKeyphrase = keywords[0] || titleWords.slice(0, 3).join(' ')
      if (!seoMeta.keyphraseSynonyms) seoMeta.keyphraseSynonyms = keywords[1] || titleWords.slice(-3).join(' ')
      if (!seoMeta.yoastTitle) seoMeta.yoastTitle = title
      if (!seoMeta.slug) seoMeta.slug = titleWords.slice(0, 8).join('-').slice(0, 60)
    }

    return NextResponse.json({ seo: seoMeta })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'SEO generation failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
