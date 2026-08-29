import { NextRequest, NextResponse } from 'next/server'
import { AVAILABLE_MODELS } from '@/lib/openrouter'
import { IMAGE_GEN_MODELS } from '@/lib/image-gen'

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'

// The upstream catalogue is public and changes rarely, so cache it for an hour.
// The route itself is dynamic because callers can ask about extra model ids.
const CATALOGUE_TTL = 3600

// Guards against a caller asking for an unbounded id list. Generous because
// the pickers ask about every model the user has kept, not just one.
const MAX_EXTRA_IDS = 60

interface OpenRouterModel {
  id: string
  name?: string
  context_length?: number
  // Dollars as strings. `image` is the price of an image sent in; `image_output`
  // is the price of one generated -- the image picker wants the latter.
  pricing?: { prompt?: string; completion?: string; image?: string; image_output?: string }
}

export interface ModelPricing {
  inputPerM: number
  outputPerM: number
  contextLength: number | null
  /** Dollars per generated image, for models billed that way. */
  imagePerImage?: number | null
}

export async function GET(req: NextRequest) {
  // `ids` lets the picker price a custom model the user typed in
  const extraIds = (req.nextUrl.searchParams.get('ids') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_EXTRA_IDS)

  try {
    const res = await fetch(OPENROUTER_MODELS_URL, {
      next: { revalidate: CATALOGUE_TTL },
      signal: AbortSignal.timeout(10000),
    })
    // ok:false tells the picker the catalogue could not be read at all, which
    // is not the same as a model being absent from it. Without that
    // distinction a network blip would grey out every model on the page.
    if (!res.ok) return NextResponse.json({ pricing: {}, available: [], names: {}, ok: false })

    const json = await res.json()
    // Image models are priced here too, so the image picker can show real
    // numbers instead of guessing.
    const wanted = new Set([
      ...AVAILABLE_MODELS.map((m) => m.id),
      ...IMAGE_GEN_MODELS.map((m) => m.id),
      ...extraIds,
    ])
    const pricing: Record<string, ModelPricing> = {}
    // Every wanted id the catalogue actually carries, priced or not. A model
    // can be listed with no usable rate, and that still means it exists.
    const available: string[] = []
    // Catalogue display names, so a model kept by pasting its id can be shown
    // as "GPT-5.6 Luna" rather than only as openai/gpt-5.6-luna.
    const names: Record<string, string> = {}

    for (const model of (json.data || []) as OpenRouterModel[]) {
      if (!wanted.has(model.id)) continue
      available.push(model.id)
      if (model.name) names[model.id] = model.name

      const prompt = Number(model.pricing?.prompt)
      const completion = Number(model.pricing?.completion)
      const perImage = Number(model.pricing?.image_output)
      const hasTokens = Number.isFinite(prompt) && Number.isFinite(completion)
      const hasImage = Number.isFinite(perImage) && perImage > 0

      // An image model may carry no token rates at all; keep it as long as it
      // is priced somehow.
      if (!hasTokens && !hasImage) continue

      pricing[model.id] = {
        inputPerM: hasTokens ? prompt * 1_000_000 : 0,
        outputPerM: hasTokens ? completion * 1_000_000 : 0,
        contextLength: model.context_length ?? null,
        imagePerImage: hasImage ? perImage : null,
      }
    }

    return NextResponse.json({ pricing, available, names, ok: true })
  } catch {
    // Pricing is decoration — never let it break the picker
    return NextResponse.json({ pricing: {}, available: [], names: {}, ok: false })
  }
}
