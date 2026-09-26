/**
 * Runs one generation step (idea / article / seo / image) with retries and
 * model fallback. Used by the Autopilot tick so a single flaky OpenRouter
 * call doesn't sink a whole article — and, when a model has been quietly
 * deprecated, the user's most-recent alternatives get tried automatically
 * rather than the tick just failing.
 *
 * Fallback source is deliberately `ai_usage` (the user's actual generation
 * history for that step) rather than a hardcoded chain: it reflects what
 * the user actually uses, so the second attempt is always something they've
 * priced and vetted. A brand-new user with an empty history will fail
 * after the primary retries — that's the intended signal.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** The four steps `ai_usage.step` accepts for autopilot-relevant work. */
export type FallbackStep = 'idea' | 'article' | 'seo' | 'image'

interface Options<T> {
  supabase: SupabaseClient
  userId: string
  step: FallbackStep
  primaryModel: string
  /** The generation itself. Receives the model to use; must throw on failure. */
  attempt: (model: string) => Promise<T>
  /** Optional per-attempt hook, for logger.warn from the tick. */
  onAttemptFail?: (model: string, tryNumber: number, err: unknown) => void
}

export interface FallbackResult<T> {
  result: T
  /** Model that finally succeeded — may differ from primaryModel. */
  model: string
  /** True when the primary model exhausted its retries and a fallback ran. */
  usedFallback: boolean
}

const PRIMARY_TRIES = 3
const FALLBACK_LIMIT = 5

export async function runWithFallback<T>({
  supabase, userId, step, primaryModel, attempt, onAttemptFail,
}: Options<T>): Promise<FallbackResult<T>> {
  // First error is what we throw at the end — it's the one the user will
  // read as the reason autopilot fell back to a draft. Later fallback
  // errors are secondary and only surface through onAttemptFail.
  let firstError: unknown = null

  for (let tryNumber = 1; tryNumber <= PRIMARY_TRIES; tryNumber++) {
    try {
      const result = await attempt(primaryModel)
      return { result, model: primaryModel, usedFallback: false }
    } catch (err) {
      if (!firstError) firstError = err
      onAttemptFail?.(primaryModel, tryNumber, err)
    }
  }

  const fallbacks = await lastDistinctModels({ supabase, userId, step, exclude: primaryModel })

  for (const model of fallbacks) {
    try {
      const result = await attempt(model)
      return { result, model, usedFallback: true }
    } catch (err) {
      onAttemptFail?.(model, 1, err)
    }
  }

  throw firstError instanceof Error
    ? firstError
    : new Error(`No model could complete "${step}" step`)
}

/**
 * The user's last `FALLBACK_LIMIT` distinct models for `step`, newest first,
 * excluding the primary. Reads a wider window than the return limit so a
 * user who only ever uses two models still has both surfaced without a
 * cursor.
 */
async function lastDistinctModels({
  supabase, userId, step, exclude,
}: { supabase: SupabaseClient; userId: string; step: string; exclude: string }): Promise<string[]> {
  const { data } = await supabase
    .from('ai_usage')
    .select('model, created_at')
    .eq('user_id', userId)
    .eq('step', step)
    .order('created_at', { ascending: false })
    .limit(50)

  if (!data) return []

  const seen = new Set<string>([exclude])
  const out: string[] = []
  for (const row of data as Array<{ model: string | null }>) {
    const m = row.model
    if (!m || seen.has(m)) continue
    seen.add(m)
    out.push(m)
    if (out.length >= FALLBACK_LIMIT) break
  }
  return out
}
