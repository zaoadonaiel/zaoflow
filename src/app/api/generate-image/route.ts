import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { generateImage, getDefaultSize } from '@/lib/image-gen'
import { recordUsage, type UsageRecord } from '@/lib/ai-cost'

export const maxDuration = 120

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: settings } = await supabase
    .from('api_settings')
    .select('openrouter_api_key')
    .eq('user_id', user.id)
    .single()

  if (!settings?.openrouter_api_key) {
    return NextResponse.json({ error: 'OpenRouter API key not set. Add it in Settings.' }, { status: 422 })
  }

  const body = await req.json()
  const { prompt, model = 'openai/gpt-image-1', articleId, siteId } = body
  const size = body.size || getDefaultSize(model)

  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
  }

  try {
    const { url: imageSource, b64, usage } = await generateImage({
      apiKey: settings.openrouter_api_key,
      prompt,
      model,
      size,
    })

    // Get raw bytes — handle both a URL response and a base64 response
    let imageBytes: Buffer
    let contentType = 'image/png'

    if (b64) {
      imageBytes = Buffer.from(b64, 'base64')
    } else if (imageSource) {
      const imgRes = await fetch(imageSource, { signal: AbortSignal.timeout(30000) })
      if (!imgRes.ok) throw new Error('Failed to download generated image')
      contentType = imgRes.headers.get('content-type') || 'image/png'
      imageBytes = Buffer.from(await imgRes.arrayBuffer())
    } else {
      throw new Error('Image generation returned no data')
    }

    const ext = contentType.includes('jpeg') ? 'jpg' : 'png'

    // Upload to Supabase Storage
    const serviceClient = createServiceClient()
    const storagePath = `${user.id}/${Date.now()}.${ext}`

    await serviceClient.storage.createBucket('article-images', { public: true }).catch(() => {})

    const { error: uploadError } = await serviceClient.storage
      .from('article-images')
      .upload(storagePath, imageBytes, { contentType, upsert: false })

    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`)

    const { data: { publicUrl } } = serviceClient.storage
      .from('article-images')
      .getPublicUrl(storagePath)

    if (articleId) {
      await supabase.from('articles').update({
        featured_image_url: publicUrl,
        featured_image_prompt: prompt,
        updated_at: new Date().toISOString(),
      }).eq('id', articleId).eq('user_id', user.id)
    }

    // Recorded so the Image Library can find every generation. The file is
    // already in the bucket either way — a failed insert is worth a warning
    // in the logs but must not fail the whole request, since the caller
    // still needs the url to attach to the article.
    const { data: libRow, error: libError } = await supabase
      .from('generated_images')
      .insert({
        user_id: user.id,
        article_id: articleId || null,
        site_id: siteId || null,
        prompt,
        model,
        url: publicUrl,
        storage_path: storagePath,
        bytes: imageBytes.length,
      })
      .select('id')
      .single()

    if (libError) {
      console.warn('generated_images insert failed:', libError.message)
    }

    const receipt: UsageRecord[] = []
    const rec = await recordUsage({
      supabase, userId: user.id, step: 'image',
      usage, articleId: articleId || null,
    })
    if (rec) receipt.push(rec)

    return NextResponse.json({
      imageUrl: publicUrl,
      prompt,
      imageId: libRow?.id ?? null,
      usage_ids: receipt.map((r) => r.id),
      receipt,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Image generation failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
