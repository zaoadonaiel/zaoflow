import { NextRequest, NextResponse } from 'next/server'
import mammoth from 'mammoth'
import { createClient } from '@/lib/supabase/server'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * GET  /api/seo-pages/city-lists            → list this user's saved lists
 * POST /api/seo-pages/city-lists            → upload a .docx + model, extract
 *                                             cities, save as a CSV row
 *
 * The upload body is `multipart/form-data` with:
 *   file  — .docx file (required)
 *   model — OpenRouter model id (required)
 *   name  — optional display name; defaults to the filename
 */

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('city_lists')
    .select('id, name, source_filename, city_count, ai_model, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ cityLists: data || [] })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })

  const file = form.get('file')
  const model = String(form.get('model') || '').trim()
  const listName = String(form.get('name') || '').trim()

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'A .docx file is required' }, { status: 400 })
  }
  if (!model) {
    return NextResponse.json({ error: 'An AI model is required' }, { status: 400 })
  }
  if (!file.name.toLowerCase().endsWith('.docx')) {
    return NextResponse.json({ error: 'Only .docx files are supported' }, { status: 400 })
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

  let rawText = ''
  try {
    const buf = Buffer.from(await file.arrayBuffer())
    const result = await mammoth.extractRawText({ buffer: buf })
    rawText = (result.value || '').trim()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to read .docx'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
  if (!rawText) {
    return NextResponse.json({ error: 'The document had no readable text' }, { status: 400 })
  }

  // Model is told to output CSV directly — headers first, then one row per
  // city. Verbatim extraction, no invented cities: the user picked "first
  // option" (extract, not expand) when the feature was scoped.
  const systemPrompt = `You extract US city names from freeform text and output them as a two-column CSV.

Output format — strict:
- First line is exactly: city,state
- Each subsequent line is one city. Cell values are unquoted unless they contain a comma.
- \`state\` is the two-letter USPS state code when the source text specifies it (e.g. "Belmont, CA" → CA). If the state is not stated in the text, leave the state cell empty.
- Keep original casing for city names (title case is fine). Deduplicate exact repeats.
- Never invent cities that aren't in the source text.
- No commentary, no code fences, no trailing blank lines. CSV only.`

  const userPrompt = `Extract every US city mentioned in this document and output the CSV.

DOCUMENT:
${rawText}`

  const aiRes = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://zaoflo.com',
      'X-Title': 'Zaoflo - Auto Post',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
      max_tokens: 4000,
    }),
  })

  if (!aiRes.ok) {
    const err = await aiRes.json().catch(() => ({}))
    const msg = err?.error?.message || `OpenRouter error: ${aiRes.status}`
    return NextResponse.json({ error: msg }, { status: 500 })
  }
  const aiJson = await aiRes.json()
  const rawCsv: string = (aiJson.choices?.[0]?.message?.content || '').trim()

  const csvContent = normalizeCsv(rawCsv)
  const cityCount = countCityRows(csvContent)
  if (cityCount === 0) {
    return NextResponse.json(
      { error: 'The model returned no cities. Try a different model or edit the document.' },
      { status: 422 },
    )
  }

  const name = listName || file.name.replace(/\.docx$/i, '')

  const { data: row, error } = await supabase
    .from('city_lists')
    .insert({
      user_id: user.id,
      name,
      source_filename: file.name,
      csv_content: csvContent,
      city_count: cityCount,
      ai_model: model,
    })
    .select('id, name, source_filename, city_count, ai_model, created_at, csv_content')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ cityList: row })
}

/** Strip code fences (some models add them anyway), collapse blank lines, and
 *  ensure the header row is present. Leaves data rows untouched. */
function normalizeCsv(input: string): string {
  const stripped = input
    .replace(/^```(?:csv|text)?\s*/i, '')
    .replace(/```$/i, '')
    .trim()
  const lines = stripped.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return ''
  const header = lines[0].toLowerCase().replace(/\s+/g, '')
  const withHeader = header.startsWith('city,') ? lines : ['city,state', ...lines]
  return withHeader.join('\n')
}

function countCityRows(csv: string): number {
  const lines = csv.split(/\r?\n/).filter(Boolean)
  return Math.max(0, lines.length - 1)
}
