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
  // Dollars per single token, as strings
  pricing?: { prompt?: string; completion?: string }
}

export interface ModelPricing {
  inputPerM: number
  outputPerM: number
  contextLength: number | null
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
    if (!res.ok) return NextResponse.json({ pricing: {} })

    const json = await res.json()
    const wanted = new Set([...AVAILABLE_MODELS.map((m) => m.id), ...extraIds])
    const pricing: Record<string, ModelPricing> = {}

    for (const model of (json.data || []) as OpenRouterModel[]) {
      if (!wanted.has(model.id)) continue

      const prompt = Number(model.pricing?.prompt)
      const completion = Number(model.pricing?.completion)
      if (!Number.isFinite(prompt) || !Number.isFinite(completion)) continue

      pricing[model.id] = {
        inputPerM: prompt * 1_000_000,
        outputPerM: completion * 1_000_000,
        contextLength: model.context_length ?? null,
      }
    }

    return NextResponse.json({ pricing })
  } catch {
    // Pricing is decoration — never let it break the picker
    return NextResponse.json({ pricing: {} })
  }
}
