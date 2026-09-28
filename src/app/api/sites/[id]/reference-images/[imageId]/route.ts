import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import {
  isMissingReferenceTableError,
  IMAGE_KB_MIGRATION_MESSAGE,
} from '@/lib/image-knowledge'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; imageId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const updates: Record<string, unknown> = {}
  if (typeof body.label === 'string') updates.label = body.label.trim().slice(0, 120)
  if (typeof body.description === 'string') updates.description = body.description.trim().slice(0, 1500)
  if (typeof body.kind === 'string') {
    const k = body.kind.toLowerCase()
    if (!['person', 'logo', 'other'].includes(k)) {
      return NextResponse.json({ error: 'kind must be person, logo or other' }, { status: 400 })
    }
    updates.kind = k
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('site_reference_images')
    .update(updates)
    .eq('id', params.imageId)
    .eq('site_id', params.id)
    .eq('user_id', user.id)
    .select('id, kind, label, description, url, storage_path, bytes, created_at')
    .single()

  if (isMissingReferenceTableError(error)) {
    return NextResponse.json({ error: IMAGE_KB_MIGRATION_MESSAGE }, { status: 503 })
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ reference: data })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; imageId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: row, error: fetchErr } = await supabase
    .from('site_reference_images')
    .select('storage_path')
    .eq('id', params.imageId)
    .eq('site_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (isMissingReferenceTableError(fetchErr)) {
    return NextResponse.json({ error: IMAGE_KB_MIGRATION_MESSAGE }, { status: 503 })
  }
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error: delErr } = await supabase
    .from('site_reference_images')
    .delete()
    .eq('id', params.imageId)
    .eq('site_id', params.id)
    .eq('user_id', user.id)

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  // File removed after the row so a partial failure never leaves a live row
  // pointing at deleted bytes. If the storage delete fails we log and move on:
  // an orphaned file is cheaper than a 500 for something the user considers done.
  if (row.storage_path) {
    const service = createServiceClient()
    await service.storage.from('reference-images').remove([row.storage_path]).catch((e) => {
      console.warn('reference-images storage delete failed:', e?.message)
    })
  }

  return NextResponse.json({ ok: true })
}
