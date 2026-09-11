import { NextRequest, NextResponse } from 'next/server'
import { AVAILABLE_MODELS } from '@/lib/openrouter'

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'

// The upstream catalogue is public and changes rarely, so cache it for an hour.
// The route itself is dynamic because callers can ask about extra model ids.
const CATALOGUE_TTL = 3600

// Guards against a caller asking for an unbounded id list
const MAX_EXTRA_IDS = 10

interface OpenRouterModel {
  id: string
  context_length?: number
  // Dollars per single token, as strings. `image_output` is dollars per
  // generated image — image models bill this way even when they also report
  // token pricing.
  pricing?: { prompt?: string; completion?: string; image_output?: string }
}

export interface ModelPricing {
  inputPerM: number
  outputPerM: number
  /** Null when the model is not priced per generated image. */
  perImage: number | null
  contextLength: number | null
}

export async function GET(req: NextRequest) {
  // `ids` lets the picker price a custom model the user typed in
  const extraIds = (req.nextUrl.searchParams.get('ids') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_EXTRA_IDS)
  // `nocache=1` skips the hourly revalidate window — used by the picker's
  // manual refresh button so the user can force a fresh read of OpenRouter's
  // catalogue when a price looks stale or a model has been retired upstream.
  const nocache = req.nextUrl.searchParams.get('nocache') === '1'

  try {
    const res = await fetch(OPENROUTER_MODELS_URL, {
      ...(nocache
        ? { cache: 'no-store' as const }
        : { next: { revalidate: CATALOGUE_TTL } }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return NextResponse.json({ pricing: {}, discontinued: [], ok: false })

    const json = await res.json()
    const wanted = new Set([...AVAILABLE_MODELS.map((m) => m.id), ...extraIds])
    const pricing: Record<string, ModelPricing> = {}
    const seen = new Set<string>()

    for (const model of (json.data || []) as OpenRouterModel[]) {
      if (!wanted.has(model.id)) continue
      seen.add(model.id)

      const prompt = Number(model.pricing?.prompt)
      const completion = Number(model.pricing?.completion)
      const imageOutput = Number(model.pricing?.image_output)
      // Text models must expose token prices; image models often report 0/0
      // for tokens and put the real cost in `image_output`, so accept the row
      // when either side of the pricing is usable.
      const hasTokenPricing = Number.isFinite(prompt) && Number.isFinite(completion)
      const hasImagePricing = Number.isFinite(imageOutput) && imageOutput > 0
      if (!hasTokenPricing && !hasImagePricing) continue

      pricing[model.id] = {
        inputPerM: hasTokenPricing ? prompt * 1_000_000 : 0,
        outputPerM: hasTokenPricing ? completion * 1_000_000 : 0,
        perImage: hasImagePricing ? imageOutput : null,
        contextLength: model.context_length ?? null,
      }
    }

    // A model we asked about but OpenRouter didn't list is one they've
    // retired — the picker greys these out so the user cannot pick a model
    // that would 404 the moment they try to generate with it.
    const discontinued = [...wanted].filter((id) => !seen.has(id))

    return NextResponse.json({ pricing, discontinued, ok: true })
  } catch {
    // Pricing is decoration — never let it break the picker
    return NextResponse.json({ pricing: {}, discontinued: [], ok: false })
  }
}
