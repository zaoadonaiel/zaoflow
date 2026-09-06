import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 60

/** Content types we accept from the client-side compressor. */
const ALLOWED: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
}

/**
 * Replace a library image with a smaller version.
 *
 * The compression runs in the browser (canvas → WebP/JPEG) so we can preview
 * quality before uploading and never pay to re-encode server-side. This route
 * takes the resulting blob, stores it on a new path, points the library row at
 * it, and best-effort updates anywhere the old URL was already referenced.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let form: FormData
  try { form = await req.formData() }
  catch { return NextResponse.json({ error: 'Compressed file did not arrive' }, { status: 400 }) }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Compressed file did not arrive' }, { status: 400 })
  }
  const ext = ALLOWED[file.type]
  if (!ext) {
    return NextResponse.json(
      { error: `Compressed file must be image/webp or image/jpeg (got ${file.type || 'unknown'})` },
      { status: 415 },
    )
  }

  // Ownership: only the row's owner can replace it.
  const { data: image, error: imgErr } = await supabase
    .from('generated_images')
    .select('id, url, storage_path, bytes')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (imgErr || !image) {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 })
  }

  const service = createServiceClient()
  const newPath = `${user.id}/${Date.now()}-compressed.${ext}`
  const bytes = Buffer.from(await file.arrayBuffer())

  const { error: uploadError } = await service.storage
    .from('article-images')
    .upload(newPath, bytes, { contentType: file.type, upsert: false })

  if (uploadError) {
    return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 })
  }

  const { data: { publicUrl } } = service.storage
    .from('article-images')
    .getPublicUrl(newPath)

  const oldUrl = image.url
  const oldPath = image.storage_path

  const { error: updateErr } = await supabase
    .from('generated_images')
    .update({ url: publicUrl, storage_path: newPath, bytes: bytes.length })
    .eq('id', image.id)
    .eq('user_id', user.id)

  if (updateErr) {
    // Roll back the fresh upload so we don't leave an orphan file.
    await service.storage.from('article-images').remove([newPath]).catch(() => {})
    return NextResponse.json({ error: `Could not update the library: ${updateErr.message}` }, { status: 500 })
  }

  // If any article was pointing at the old URL for its featured image, follow
  // it to the new one — otherwise the article page would show a broken image
  // as soon as the old file is deleted. Best-effort; a missing column or a
  // permission problem must not undo the successful compress.
  if (oldUrl) {
    await supabase
      .from('articles')
      .update({ featured_image_url: publicUrl })
      .eq('user_id', user.id)
      .eq('featured_image_url', oldUrl)
      .then(() => {}, () => {})
  }

  // Old file goes at the end. If this fails the row already points at the new
  // URL, so the compress is done — the leftover is a cleanup task, not a bug.
  if (oldPath) {
    await service.storage.from('article-images').remove([oldPath]).catch(() => {})
  }

  return NextResponse.json({
    url: publicUrl,
    storage_path: newPath,
    bytes: bytes.length,
    previous_bytes: image.bytes ?? null,
  })
}
