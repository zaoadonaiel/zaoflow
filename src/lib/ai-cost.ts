/**
 * Turning token counts into dollars.
 *
 * OpenRouter reports tokens on every completion but not a price, so the rate
 * comes from its public catalogue and the multiplication happens here.
 */

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'

/** Persistable steps — the DB check constraint on ai_usage.step accepts these. */
export type PersistedStep = 'idea' | 'article' | 'seo' | 'image'
/** Everything a receipt row can carry, including the client-only web search line. */
export type AiStep = PersistedStep | 'web_search'

/**
 * OpenRouter's `web` plugin bills via Exa: $4 per 1,000 results, default 5
 * results per call. That's the flat per-call estimate we show on the receipt.
 * Not persisted to ai_usage — the DB check constraint doesn't know this step
 * and the stats page doesn't need to break it out.
 */
export const WEB_SEARCH_COST_PER_CALL = 0.02

/**
 * Synthetic UsageRecord for the receipt when live web search was on. Sits
 * alongside the persisted rows without going through recordUsage — its cost is
 * a flat estimate, not a token calculation, and it never carries an article id
 * back to Supabase.
 */
export function webSearchReceiptRow(calls: number, keySuffix: string): UsageRecord | null {
  if (calls <= 0) return null
  return {
    id: `web:${keySuffix}`,
    step: 'web_search',
    model: 'openrouter/web',
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    cost_usd: calls * WEB_SEARCH_COST_PER_CALL,
  }
}

export interface UsageInfo {
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** How many images this call produced. Zero for text generations. */
  images?: number
}

/** Reads the usage block off an OpenRouter response, tolerating its absence. */
export function readUsage(data: unknown, fallbackModel: string): UsageInfo {
  const d = (data || {}) as Record<string, unknown>
  const u = (d.usage || {}) as Record<string, number>
  const prompt = u.prompt_tokens ?? 0
  const completion = u.completion_tokens ?? 0
  return {
    model: (d.model as string) || fallbackModel,
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: u.total_tokens ?? prompt + completion,
  }
}

/**
 * The same, for the images endpoint, which reports its tokens under different
 * names than the chat endpoint (input/output rather than prompt/completion) and
 * on some models does not report them at all.
 */
export function readImageUsage(data: unknown, fallbackModel: string, images: number): UsageInfo {
  const d = (data || {}) as Record<string, unknown>
  const u = (d.usage || {}) as Record<string, number>
  const prompt = u.input_tokens ?? u.prompt_tokens ?? 0
  const completion = u.output_tokens ?? u.completion_tokens ?? 0
  return {
    model: (d.model as string) || fallbackModel,
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: u.total_tokens ?? prompt + completion,
    images,
  }
}

/** Sums several calls — retries and multi-step routes bill for every attempt. */
export function sumUsage(parts: UsageInfo[], fallbackModel: string): UsageInfo {
  return {
    model: parts[0]?.model || fallbackModel,
    promptTokens: parts.reduce((n, p) => n + p.promptTokens, 0),
    completionTokens: parts.reduce((n, p) => n + p.completionTokens, 0),
    totalTokens: parts.reduce((n, p) => n + p.totalTokens, 0),
    images: parts.reduce((n, p) => n + (p.images ?? 0), 0),
  }
}

interface Rate {
  inputPerToken: number
  outputPerToken: number
  /** Flat price per generated image, for models not billed by token. */
  perImage: number
}

/**
 * Catalogue rates, cached for an hour — prices change rarely and this sits in
 * the path of every generation.
 */
export async function fetchRates(): Promise<Record<string, Rate>> {
  try {
    const res = await fetch(OPENROUTER_MODELS_URL, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return {}
    const json = await res.json()
    const out: Record<string, Rate> = {}
    for (const m of json?.data || []) {
      const p = m?.pricing
      if (!p) continue
      out[m.id] = {
        inputPerToken: Number(p.prompt) || 0,
        outputPerToken: Number(p.completion) || 0,
        // `image_output` is what a generated image costs; `image` is the price
        // of an image sent *in* to a multimodal model, so it must not stand in.
        perImage: Number(p.image_output) || 0,
      }
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Dollars for one call, or null when it genuinely cannot be known — a model
 * absent from the catalogue, or one not priced per token at all. Null is
 * displayed as unknown rather than as free.
 */
export function costOf(usage: UsageInfo, rates: Record<string, Rate>): number | null {
  const rate = rates[usage.model]
  if (!rate) return null

  const perToken = rate.inputPerToken || rate.outputPerToken
  if (perToken && usage.totalTokens > 0) {
    return usage.promptTokens * rate.inputPerToken + usage.completionTokens * rate.outputPerToken
  }

  // Image models mostly bill a flat rate and report no tokens. This is the
  // catalogue's own per-image price, not a guess -- and when the catalogue does
  // not carry one either, the cost stays unknown rather than becoming zero.
  const images = usage.images ?? 0
  if (images > 0 && rate.perImage) return images * rate.perImage

  return null
}

export interface UsageRecord {
  id: string
  step: AiStep
  model: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cost_usd: number | null
}

/**
 * Persists one step's usage, priced, and hands back the row for display.
 *
 * Rows start unattached because every generation step runs before the article
 * exists; the id is carried by the editor and attached when it saves.
 * Best-effort by design — failing to record a cost must never fail a
 * generation the user is waiting on.
 */
export async function recordUsage({
  supabase,
  userId,
  step,
  usage,
  articleId,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  userId: string
  step: PersistedStep
  usage: UsageInfo
  articleId?: string | null
}): Promise<UsageRecord | null> {
  try {
    const rates = await fetchRates()
    const cost = costOf(usage, rates)

    const { data } = await supabase
      .from('ai_usage')
      .insert({
        user_id: userId,
        article_id: articleId || null,
        step,
        model: usage.model,
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
        total_tokens: usage.totalTokens,
        cost_usd: cost,
      })
      .select('id, step, model, prompt_tokens, completion_tokens, total_tokens, cost_usd')
      .single()

    return (data as UsageRecord) ?? null
  } catch {
    return null
  }
}
