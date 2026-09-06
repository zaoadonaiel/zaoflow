import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { wordCountLimitError, MAX_ARTICLE_WORDS } from '@/lib/instruction-limits'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: instructions, error } = await supabase
    .from('article_instructions')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ instructions })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const instructions = typeof body.instructions === 'string' ? body.instructions.trim() : ''

  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!instructions) return NextResponse.json({ error: 'Instructions are required' }, { status: 400 })

  const limitError = wordCountLimitError(instructions)
  if (limitError) return NextResponse.json({ error: limitError }, { status: 400 })

  const parsed = readLengthTriple(body)
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const { data: instruction, error } = await supabase
    .from('article_instructions')
    .insert({
      user_id: user.id,
      name,
      instructions,
      min_words: parsed.min,
      target_words: parsed.target,
      max_words: parsed.max,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ instruction }, { status: 201 })
}

// Validates the optional length triple against the same rules as the DB check
// constraint. Exported so the PATCH route reuses it verbatim.
export function readLengthTriple(body: Record<string, unknown>): {
  min: number | null; target: number | null; max: number | null; error: string | null
} {
  const min = normalise(body.min_words)
  const target = normalise(body.target_words)
  const max = normalise(body.max_words)
  for (const [label, n] of [['min_words', min], ['target_words', target], ['max_words', max]] as const) {
    if (n !== null && (n < 1 || n > MAX_ARTICLE_WORDS)) {
      return { min, target, max, error: `${label} must be between 1 and ${MAX_ARTICLE_WORDS}` }
    }
  }
  if (min !== null && max !== null && min > max) return { min, target, max, error: 'min_words must be ≤ max_words' }
  if (min !== null && target !== null && target < min) return { min, target, max, error: 'target_words must be ≥ min_words' }
  if (target !== null && max !== null && target > max) return { min, target, max, error: 'target_words must be ≤ max_words' }
  return { min, target, max, error: null }
}

function normalise(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseInt(String(v), 10)
  return Number.isFinite(n) ? Math.round(n) : null
}
