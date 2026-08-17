import { NextResponse } from 'next/server'
import { AVAILABLE_MODELS } from '@/lib/openrouter'

// Pricing changes rarely and the catalogue is public, so cache it for an hour
// rather than hitting OpenRouter every time someone opens the model picker.
export const revalidate = 3600

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'

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

export async function GET() {
  try {
    const res = await fetch(OPENROUTER_MODELS_URL, {
      next: { revalidate },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return NextResponse.json({ pricing: {} })

    const json = await res.json()
    const wanted = new Set(AVAILABLE_MODELS.map((m) => m.id))
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
