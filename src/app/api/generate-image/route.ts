import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { generateImage, getDefaultSize } from '@/lib/image-gen'
import { recordUsage, readImageUsage, fetchRates, costOf } from '@/lib/ai-cost'

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
  const { prompt, model = 'google/gemini-3.1-flash-image', articleId, siteId } = body
  const size = body.size || getDefaultSize(model)

  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
  }

  try {
    const { url: imageSource, b64, raw } = await generateImage({
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

    // The library row is written before the article is touched, so an image
    // still lands in the library when it was generated for an article that has
    // not been saved yet. A missing table here must not fail the generation --
    // the image exists either way, and the library is the thing that degrades.
    let imageSiteId: string | null = siteId || null
    if (!imageSiteId && articleId) {
      const { data: a } = await supabase
        .from('articles')
        .select('site_id')
        .eq('id', articleId)
        .eq('user_id', user.id)
        .single()
      imageSiteId = a?.site_id || null
    }
    // What it cost and what it weighs, recorded now because neither can be
    // recovered later: the usage block is gone once the response is discarded,
    // and an unsaved article leaves no ai_usage row to join back to.
    const imageUsage = readImageUsage(raw, model, 1)
    const imageCost = costOf(imageUsage, await fetchRates())

    const { error: libraryError } = await supabase.from('generated_images').insert({
      user_id: user.id,
      article_id: articleId || null,
      site_id: imageSiteId,
      prompt,
      model,
      url: publicUrl,
      storage_path: storagePath,
      prompt_tokens: imageUsage.promptTokens,
      completion_tokens: imageUsage.completionTokens,
      total_tokens: imageUsage.totalTokens,
      cost_usd: imageCost,
      bytes: imageBytes.length,
    })
    if (libraryError) console.warn('generated_images insert failed:', libraryError.message)

    if (articleId) {
      await supabase.from('articles').update({
        featured_image_url: publicUrl,
        featured_image_prompt: prompt,
        updated_at: new Date().toISOString(),
      }).eq('id', articleId).eq('user_id', user.id)
    }

    // Whatever the model reported, priced against the catalogue. Models that
    // report no tokens and carry no per-image price still record null rather
    // than a zero, which would read as free.
    const usageId = await recordUsage({
      supabase,
      userId: user.id,
      step: 'image',
      usage: imageUsage,
      articleId: articleId || null,
    })

    return NextResponse.json({
      imageUrl: publicUrl,
      prompt,
      usage_ids: usageId ? [usageId] : [],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Image generation failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
