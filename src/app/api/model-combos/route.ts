import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * User's saved model combos, newest first.
 *
 * A "combo" is the set of four models an article uses end to end — idea,
 * body, SEO/Yoast, image. Kept as strings rather than FKs since OpenRouter's
 * catalogue can drop an id without warning, and a combo referencing an
 * expired model should still show up so the user can substitute it.
 */
export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('model_combos')
    .select('id, name, idea_model, article_model, seo_model, image_model, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    // The table is missing until migration 038 has been applied; say so once
    // instead of a generic 500 that reads like data loss in the UI.
    const missing = /does not exist|schema cache/i.test(error.message)
      && /model_combos/.test(error.message)
    return NextResponse.json(
      { error: missing
        ? 'Model combos table is missing — run supabase/migrations/038_model_combos.sql.'
        : error.message },
      { status: missing ? 503 : 500 },
    )
  }

  return NextResponse.json({ combos: data ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 60) : ''
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

  const { data, error } = await supabase
    .from('model_combos')
    .insert({
      user_id: user.id,
      name,
      idea_model: pick(body?.idea_model),
      article_model: pick(body?.article_model),
      seo_model: pick(body?.seo_model),
      image_model: pick(body?.image_model),
    })
    .select('id, name, idea_model, article_model, seo_model, image_model, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ combo: data }, { status: 201 })
}
