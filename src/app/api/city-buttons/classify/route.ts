import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'

// A batch this size lands in <10s on most models and keeps the JSON
// response body under a few KB. The client is responsible for slicing a
// long page list into successive calls of this size so a 700-page site
// can show incremental progress instead of a single 60-second stall.
const MAX_BATCH_SIZE = 50

interface InputPage {
  id: number
  title: string
  slug?: string
}

interface ClassifiedPage {
  id: number
  county: string | null
  state: string | null
}

/**
 * Classify a batch of WordPress pages into US counties using an
 * OpenRouter model of the caller's choice. Results are upserted to
 * `page_counties` so the picker doesn't re-pay for the same page next
 * time. Each call handles one batch — the client orchestrates progress.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null) as {
    site_id?: string
    model?: string
    pages?: InputPage[]
  } | null

  const siteId = body?.site_id
  const model = body?.model?.trim()
  const pages = Array.isArray(body?.pages) ? body!.pages : []

  if (!siteId) return NextResponse.json({ error: 'site_id is required' }, { status: 400 })
  if (!model) return NextResponse.json({ error: 'model is required' }, { status: 400 })
  if (pages.length === 0) return NextResponse.json({ error: 'pages is required' }, { status: 400 })
  if (pages.length > MAX_BATCH_SIZE) {
    return NextResponse.json(
      { error: `Batch too large — max ${MAX_BATCH_SIZE} pages per call` },
      { status: 400 },
    )
  }

  // Confirm the site belongs to the caller before doing anything
  // billable, and grab a defensive snapshot for the upsert.
  const { data: site } = await supabase
    .from('sites')
    .select('id, site_type')
    .eq('id', siteId)
    .eq('user_id', user.id)
    .single()
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

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

  const systemPrompt = `You classify US city-service page titles into the US county the city belongs to.

For each input page, output the county and two-letter state code (USPS) for the city named in the title.

Rules:
- Return ONLY a JSON object of the form: {"results":[{"id":123,"county":"Los Angeles County","state":"CA"}, ...]}.
- One result per input, matched by id.
- "county" is the full county name including the word "County" (or "Parish" for Louisiana, "Borough" for Alaska where appropriate).
- "state" is the two-letter USPS code.
- If the title has no identifiable US city, or the city is ambiguous across states with no disambiguation, set both county and state to null.
- Never invent — a guess is worse than null.
- No commentary, no code fences. JSON object only.`

  const userPrompt = `Classify these pages:\n\n${JSON.stringify(
    pages.map((p) => ({ id: p.id, title: p.title, slug: p.slug })),
    null,
    2,
  )}`

  const aiRes = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://zaoflo.com',
      'X-Title': 'Zaoflo - City Buttons',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      // response_format is honored by most modern models on OpenRouter
      // (OpenAI, Anthropic, Gemini). Older/OSS models ignore it and
      // still return JSON because the system prompt spells the shape
      // out; the parser below strips fences either way.
      response_format: { type: 'json_object' },
      temperature: 0,
    }),
  })

  if (!aiRes.ok) {
    const err = await aiRes.json().catch(() => ({}))
    const msg = err?.error?.message || `OpenRouter error: ${aiRes.status}`
    return NextResponse.json({ error: msg }, { status: 502 })
  }
  const aiJson = await aiRes.json()
  const rawContent: string = (aiJson.choices?.[0]?.message?.content || '').trim()

  let parsed: { results?: unknown } = {}
  try {
    parsed = JSON.parse(stripFences(rawContent))
  } catch {
    return NextResponse.json(
      { error: 'The model returned unparsable output. Try a different model.' },
      { status: 502 },
    )
  }

  const results = Array.isArray(parsed.results) ? parsed.results : []
  const byId = new Map<number, { county: string | null; state: string | null }>()
  for (const r of results as Array<Record<string, unknown>>) {
    const id = Number(r.id)
    if (!Number.isFinite(id)) continue
    const county = typeof r.county === 'string' && r.county.trim() ? r.county.trim() : null
    const state = typeof r.state === 'string' && r.state.trim() ? r.state.trim().toUpperCase() : null
    byId.set(id, { county, state })
  }

  const classified: ClassifiedPage[] = pages.map((p) => {
    const hit = byId.get(p.id) || { county: null, state: null }
    return { id: p.id, county: hit.county, state: hit.state }
  })

  // Upsert all rows in one call — Supabase handles the (site_id,
  // wp_page_id) conflict via the unique constraint from the migration.
  const rows = pages.map((p) => {
    const hit = byId.get(p.id) || { county: null, state: null }
    return {
      user_id: user.id,
      site_id: siteId,
      wp_page_id: p.id,
      county: hit.county,
      state: hit.state,
      wp_page_title: p.title,
      wp_page_slug: p.slug ?? null,
      ai_model: model,
      updated_at: new Date().toISOString(),
    }
  })

  const { error: upsertErr } = await supabase
    .from('page_counties')
    .upsert(rows, { onConflict: 'site_id,wp_page_id' })

  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500 })
  }

  return NextResponse.json({ results: classified })
}

/** Some models wrap JSON in ```json ... ``` fences despite response_format. */
function stripFences(input: string): string {
  return input
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
}
