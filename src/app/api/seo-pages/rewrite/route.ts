import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const VALID_SIMILARITIES = [10, 25, 50, 90] as const
type Similarity = (typeof VALID_SIMILARITIES)[number]

function htmlToText(input: string): string {
  return input.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function similarityBrief(pct: Similarity): string {
  // The user's mental model: 10% similar = heavily rewritten (only 10% of the
  // original wording carries over); 90% similar = nearly the same page.
  switch (pct) {
    case 10:
      return `Aggressively rephrase every sentence. Only about 10% of the original wording should remain — swap sentence structures, replace verbs and nouns with synonyms, reorder clauses. The meaning stays; the wording changes almost completely.`
    case 25:
      return `Heavily rewrite every paragraph. Only about 25% of the original wording should remain — keep the point, but change most of the words, phrasings, and sentence shapes.`
    case 50:
      return `Rewrite about half of each paragraph. Keep roughly 50% of the original wording, replacing the rest with synonyms and alternative phrasings.`
    case 90:
      return `Lightly edit for freshness. Only about 10% of the wording should change — mostly small synonym swaps and minor phrasing tweaks. Keep sentences recognisable.`
  }
}

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
  } = body as {
    content?: string
    model?: string
    similarity?: number
    instructions?: string
    target_city?: string
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

  const originalWordCount = htmlToText(content).split(/\s+/).filter(Boolean).length

  const systemPrompt = `You are an expert SEO editor rewriting a location-cloned WordPress page so it is not a duplicate of the source. You output ONLY HTML, no code fences, no commentary.`

  const userPrompt = `Rewrite the HTML below.

HARD RULES — never break these:
- Preserve every heading tag EXACTLY: <h1>, <h2>, <h3>, <h4>, <h5>, <h6>. Their text stays word-for-word identical to the input. Do not add, remove, reorder or rename any heading.
- Preserve the HTML structure and tags: same paragraphs, same lists, same links, same images, same order.
- Keep the overall word count within ±10% of the original (${originalWordCount} words).
- Never change any city name that appears — keep every reference to "${target_city || '<the target city>'}" exactly as written.
- Output ONLY the rewritten HTML body. No <html>, <head>, <body>, no code fences, no explanatory text.

REWRITE INSTRUCTION (${similarity}% similar to the source):
${similarityBrief(similarity as Similarity)}
${instructions?.trim() ? `\nADDITIONAL AUTHOR INSTRUCTIONS (secondary to the hard rules):\n${instructions.trim()}\n` : ''}
HTML to rewrite:
${content}`

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://zaoflo.com',
      'X-Title': 'Zaoflo - SEO Pages',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      // Similarity=10 needs the model to keep almost nothing — a low
      // temperature strangles the variety it needs to actually diverge.
      temperature: similarity === 10 ? 0.9 : similarity === 25 ? 0.8 : similarity === 50 ? 0.7 : 0.5,
      max_tokens: 8000,
    }),
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
  const rawContent: string = data.choices?.[0]?.message?.content || ''

  // Strip any accidental code fences the model wraps around the HTML.
  const cleaned = rawContent
    .trim()
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  const newWordCount = htmlToText(cleaned).split(/\s+/).filter(Boolean).length

  return NextResponse.json({
    content: cleaned,
    originalWordCount,
    newWordCount,
    model,
    similarity,
  })
}
