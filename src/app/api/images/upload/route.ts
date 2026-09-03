import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 60

/** What WordPress will take as a featured image, and nothing else. */
const ALLOWED: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** Big enough for a photograph off a phone, small enough to fail fast. */
const MAX_BYTES = 15 * 1024 * 1024

/**
 * Brings an image in from the user's own machine.
 *
 * It lands in the same bucket and the same library row as a generated one, so
 * from here on nothing downstream cares where a picture came from: it is
 * pickable, publishable and countable exactly like the rest. What it is not is
 * priced — an uploaded file cost nothing, and its cost columns stay null
 * rather than claiming a zero the way a generated image never would.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
      { error: `${file.type || 'That file'} is not an image WordPress will take. Use PNG, JPEG, WebP or GIF.` },
      { status: 415 }
    )
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB, over the ${MAX_BYTES / 1024 / 1024} MB limit.` },
      { status: 413 }
    )
  }

  const articleId = (form.get('article_id') as string) || null
  let siteId = (form.get('site_id') as string) || null
  // The caption the library shows. Falls back to the file's own name, which is
  // at least something you would recognise the picture by in a grid.
  const description = ((form.get('description') as string) || file.name || 'Uploaded image').trim()

  // Both are the user's own, or neither is used — an id posted from the
  // browser is not proof of anything.
  if (siteId) {
    const { data: site } = await supabase
      .from('sites').select('id').eq('id', siteId).eq('user_id', user.id).single()
    if (!site) siteId = null
  }
  if (!siteId && articleId) {
    const { data: a } = await supabase
      .from('articles').select('site_id').eq('id', articleId).eq('user_id', user.id).single()
    siteId = a?.site_id || null
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  const service = createServiceClient()
  const storagePath = `${user.id}/${Date.now()}.${ext}`

  await service.storage.createBucket('article-images', { public: true }).catch(() => {})

  const { error: uploadError } = await service.storage
    .from('article-images')
    .upload(storagePath, bytes, { contentType: file.type, upsert: false })

  if (uploadError) {
    return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 })
  }

  const { data: { publicUrl } } = service.storage
    .from('article-images')
    .getPublicUrl(storagePath)

  const { data: image, error: libraryError } = await supabase
    .from('generated_images')
    .insert({
      user_id: user.id,
      article_id: articleId,
      site_id: siteId,
      prompt: description,
      // Not a model. It is the honest answer to "what made this", and it is
      // what tells the library an image was never generated.
      model: 'upload',
      url: publicUrl,
      storage_path: storagePath,
      bytes: bytes.length,
    })
    .select('id, article_id, site_id, prompt, model, url, storage_path, created_at, bytes')
    .single()

  if (libraryError) {
    // The file is in the bucket either way. Saying the upload failed would send
    // the user to do it again and leave two copies behind.
    console.warn('generated_images insert failed:', libraryError.message)
  }

  return NextResponse.json({
    image: image ?? {
      id: storagePath,
      url: publicUrl,
      prompt: description,
      model: 'upload',
      site_id: siteId,
      article_id: articleId,
      storage_path: storagePath,
      bytes: bytes.length,
      created_at: new Date().toISOString(),
    },
  }, { status: 201 })
}
