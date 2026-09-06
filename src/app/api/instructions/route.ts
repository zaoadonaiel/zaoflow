import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { wordCountLimitError } from '@/lib/instruction-limits'
import { readLengthTriple } from '@/lib/instruction-length-input'

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

