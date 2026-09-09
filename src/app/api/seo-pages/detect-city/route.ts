import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { recordUsage, readUsage } from '@/lib/ai-cost'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
// Cheap and reliable for one-shot structured text extraction. Hardcoded on
// purpose — this is a utility call, not something the user picks a model for.
const DETECT_MODEL = 'openai/gpt-4o-mini'

/**
 * Reads the source WordPress page's title + slug (and optionally a body
 * snippet) and asks a small model to name the city the page is about.
 *
 * Returns the city as a bare string ("Los Angeles CA", "Portland OR", or
 * "Oakland" if the page has no state qualifier). Or null when the model
 * can't be sure — the SEO builder then leaves the field blank instead of
 * seeding a wrong guess.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { title, slug, content, seo_page_id } = (await req.json()) as {
    title?: string
    slug?: string
    content?: string
    seo_page_id?: string
  }

  if (!title && !slug) {
    return NextResponse.json({ error: 'title or slug is required' }, { status: 400 })
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

  // Trim the body sample — 800 chars is plenty of context for a heading or
  // opening paragraph, and keeps the token cost of this utility call in the
  // fraction-of-a-cent range.
  const snippet = (content || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 800)

  const systemPrompt =
    'You extract the primary city from a location-specific WordPress page. ' +
    'The city is what a "we serve [city]" or "[topic] in [city]" page is anchored to. ' +
    'Return ONLY the city name plus a two-letter state code when one is clearly present, ' +
    'in the exact form "City ST" (e.g. "Los Angeles CA", "San Diego CA", "Portland OR"). ' +
    'If no state code is clearly present, return just the city (e.g. "Oakland"). ' +
    'If you cannot determine a city with reasonable confidence, return the single word: UNKNOWN. ' +
    'Do not add punctuation, commas, quotes, or any other words.'

  const userPrompt = [
    `Title: ${title || '(none)'}`,
    `URL slug: ${slug || '(none)'}`,
    snippet ? `Body opening: ${snippet}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://zaoflo.com',
      'X-Title': 'Zaoflo - SEO Pages (city detect)',
    },
    body: JSON.stringify({
      model: DETECT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
      max_tokens: 20,
    }),
    signal: AbortSignal.timeout(20000),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    if (response.status === 401 || response.status === 403) {
      return NextResponse.json({ error: 'Invalid OpenRouter API key. Update it in Settings.' }, { status: 400 })
    }
    if (response.status === 402) {
      return NextResponse.json({ error: 'OpenRouter account has no credits.' }, { status: 400 })
    }
    return NextResponse.json(
      { error: err?.error?.message || `OpenRouter error: ${response.status}` },
      { status: 500 },
    )
  }

  const data = await response.json()
  const raw: string = (data.choices?.[0]?.message?.content || '').trim()
  // Strip any accidental wrapping quotes/periods the model might add.
  const cleaned = raw.replace(/^["'.,\s]+|["'.,\s]+$/g, '')
  const city = cleaned && cleaned.toUpperCase() !== 'UNKNOWN' ? cleaned : null

  // Cost tracking — this call is tiny, but rolls up so the total on the
  // sidebar stays honest.
  const usage = readUsage(data, DETECT_MODEL)
  const rec = await recordUsage({
    supabase,
    userId: user.id,
    step: 'rewrite',
    usage,
    seoPageId: seo_page_id || null,
  })

  return NextResponse.json({ city, usage: rec })
}
