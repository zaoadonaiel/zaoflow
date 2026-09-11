import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** Field-level updates for one combo: renames, and substituting an expired
 *  model without having to delete-then-recreate the whole preset. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const update: Record<string, string | null> = {}
  const allow = ['name', 'idea_model', 'article_model', 'seo_model', 'image_model'] as const
  for (const key of allow) {
    if (!(key in body)) continue
    const raw = body[key]
    // A caller sending `null` explicitly clears the field; sending a string
    // trims and stores. Anything else is a bad request rather than silently
    // dropped so a UI bug shows up here rather than surprising the user later.
    if (raw === null) { update[key] = null; continue }
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (key === 'name') {
        if (!trimmed) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
        update[key] = trimmed.slice(0, 60)
      } else {
        update[key] = trimmed || null
      }
      continue
    }
    return NextResponse.json({ error: `Invalid value for ${key}` }, { status: 400 })
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('model_combos')
    .update(update)
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select('id, name, idea_model, article_model, seo_model, image_model, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Combo not found' }, { status: 404 })

  return NextResponse.json({ combo: data })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('model_combos')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
