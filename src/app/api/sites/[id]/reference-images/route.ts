import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import {
  isMissingReferenceTableError,
  IMAGE_KB_MIGRATION_MESSAGE,
} from '@/lib/image-knowledge'

export const maxDuration = 60

const ALLOWED: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
}

// Room for a phone photo of the owner or a full-fat logo export.
const MAX_BYTES = 15 * 1024 * 1024

const REFERENCE_KINDS = new Set(['person', 'logo', 'other'])

async function assertSiteOwned(
  supabase: ReturnType<typeof createClient>,
  siteId: string,
  userId: string,
) {
  const { data: site } = await supabase
    .from('sites')
    .select('id')
    .eq('id', siteId)
    .eq('user_id', userId)
    .single()
  return Boolean(site)
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await assertSiteOwned(supabase, params.id, user.id))) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  }

  const { data, error } = await supabase
    .from('site_reference_images')
    .select('id, kind, label, description, url, storage_path, bytes, created_at')
    .eq('site_id', params.id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (isMissingReferenceTableError(error)) {
    return NextResponse.json({ references: [], migration_required: true, warning: IMAGE_KB_MIGRATION_MESSAGE })
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ references: data || [] })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await assertSiteOwned(supabase, params.id, user.id))) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'That upload did not arrive as a file' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Choose an image to upload' }, { status: 400 })
  }

  const ext = ALLOWED[file.type]
  if (!ext) {
    return NextResponse.json(
      { error: `${file.type || 'That file'} is not accepted. Use PNG, JPEG, WebP, GIF or SVG.` },
      { status: 415 }
    )
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB, over the ${MAX_BYTES / 1024 / 1024} MB limit.` },
      { status: 413 }
    )
  }

  const rawKind = ((form.get('kind') as string) || 'person').toLowerCase()
  if (!REFERENCE_KINDS.has(rawKind)) {
    return NextResponse.json({ error: 'kind must be person, logo or other' }, { status: 400 })
  }
  const kind = rawKind as 'person' | 'logo' | 'other'
  const label = ((form.get('label') as string) || '').trim().slice(0, 120)
  const description = ((form.get('description') as string) || '').trim().slice(0, 1500)

  const bytes = Buffer.from(await file.arrayBuffer())
  const service = createServiceClient()
  const storagePath = `${user.id}/${params.id}/${Date.now()}.${ext}`

  await service.storage.createBucket('reference-images', { public: true }).catch(() => {})

  const { error: uploadError } = await service.storage
    .from('reference-images')
    .upload(storagePath, bytes, { contentType: file.type, upsert: false })

  if (uploadError) {
    return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 })
  }

  const { data: { publicUrl } } = service.storage
    .from('reference-images')
    .getPublicUrl(storagePath)

  const { data: row, error: insertError } = await supabase
    .from('site_reference_images')
    .insert({
      user_id: user.id,
      site_id: params.id,
      kind,
      label,
      description,
      url: publicUrl,
      storage_path: storagePath,
      bytes: bytes.length,
    })
    .select('id, kind, label, description, url, storage_path, bytes, created_at')
    .single()

  if (isMissingReferenceTableError(insertError)) {
    // Clean up the orphaned file so a re-run does not race a UNIQUE.
    await service.storage.from('reference-images').remove([storagePath]).catch(() => {})
    return NextResponse.json({ error: IMAGE_KB_MIGRATION_MESSAGE }, { status: 503 })
  }
  if (insertError) {
    await service.storage.from('reference-images').remove([storagePath]).catch(() => {})
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({ reference: row }, { status: 201 })
}
