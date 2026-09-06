import { MAX_ARTICLE_WORDS } from '@/lib/instruction-limits'

/**
 * Parses and validates the optional min/target/max length triple sent from the
 * instruction-set editor. Mirrors the DB check constraint on
 * article_instructions so client and server reject the same shapes.
 *
 * Lives in its own module because Next.js route files can only export the
 * handler names (GET/POST/PATCH/DELETE) plus a fixed set of config exports —
 * a shared helper next to the route breaks the build.
 */
export function readLengthTriple(body: Record<string, unknown>): {
  min: number | null; target: number | null; max: number | null; error: string | null
} {
  const min = normalise(body.min_words)
  const target = normalise(body.target_words)
  const max = normalise(body.max_words)
  for (const [label, n] of [['min_words', min], ['target_words', target], ['max_words', max]] as const) {
    if (n !== null && (n < 1 || n > MAX_ARTICLE_WORDS)) {
      return { min, target, max, error: `${label} must be between 1 and ${MAX_ARTICLE_WORDS}` }
    }
  }
  if (min !== null && max !== null && min > max) return { min, target, max, error: 'min_words must be ≤ max_words' }
  if (min !== null && target !== null && target < min) return { min, target, max, error: 'target_words must be ≥ min_words' }
  if (target !== null && max !== null && target > max) return { min, target, max, error: 'target_words must be ≤ max_words' }
  return { min, target, max, error: null }
}

function normalise(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseInt(String(v), 10)
  return Number.isFinite(n) ? Math.round(n) : null
}
