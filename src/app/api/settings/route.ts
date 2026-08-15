import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ data: settings }, { data: profile }] = await Promise.all([
    supabase.from('api_settings').select('*').eq('user_id', user.id).single(),
    supabase.from('profiles').select('full_name, email').eq('id', user.id).single(),
  ])

  return NextResponse.json({ settings, profile })
}

export async function PATCH(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { openrouter_api_key, openai_api_key, default_model } = body

  const { data: settings, error } = await supabase
    .from('api_settings')
    .upsert({
      user_id: user.id,
      openrouter_api_key: openrouter_api_key || null,
      openai_api_key: openai_api_key || null,
      default_model: default_model || 'anthropic/claude-sonnet-4.5',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings })
}
