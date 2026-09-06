import { MAX_ARTICLE_WORDS } from '@/lib/instruction-limits'

/**
 * The word-count contract for one article generation.
 *
 * Both `min` and `max` are inclusive. `target` is the model's aim; the check
 * that decides whether to retry the generation compares the produced word
 * count against `min`/`max`, not the target.
 */
export interface LengthTarget {
  min: number
  target: number
  max: number
}

/**
 * Reads an explicit length from an instruction set row.
 *
 * When only some of the three numbers are set, the missing ones are filled
 * in from the ones that are: target defaults to the midpoint of min/max, and
 * min/max default to ±10% around target. All results are clamped to the
 * per-article hard ceiling so a stray high value cannot let a generation run
 * past what `max_tokens` can actually fit.
 */
export function fromExplicitColumns(row: {
  min_words?: number | null
  target_words?: number | null
  max_words?: number | null
}): LengthTarget | null {
  const min = intOrNull(row.min_words)
  const target = intOrNull(row.target_words)
  const max = intOrNull(row.max_words)
  if (min === null && target === null && max === null) return null

  return normalise({
    min: min ?? (target !== null ? Math.round(target * 0.9) : (max !== null ? Math.round(max * 0.85) : 0)),
    target: target ?? (min !== null && max !== null ? Math.round((min + max) / 2) : (min ?? max ?? 0)),
    max: max ?? (target !== null ? Math.round(target * 1.1) : (min !== null ? Math.round(min * 1.15) : 0)),
  })
}

// "800-1000 words", "1,500 to 2,000 words", "800–1000 words"
const RANGE_WORDS = /(\d[\d,]*)\s*(?:to|-|–|—)\s*(\d[\d,]*)\s*words?\b/i
// "target 1200 words", "aim for 1500 words", "1500 word article", "1200 words"
const SINGLE_WORDS = /(?:target|aim(?:\s+for)?|around|about|approximately|roughly)?\s*(\d[\d,]*)\s*(?:word|words)\b/i
// "minimum 800", "at least 800 words", "no fewer than 800"
const MIN_ONLY = /\b(?:min(?:imum)?|at\s+least|no\s+fewer\s+than|not\s+less\s+than)\s*(\d[\d,]*)\s*(?:words?)?\b/i
// "maximum 1000", "at most 1000 words", "no more than 1000"
const MAX_ONLY = /\b(?:max(?:imum)?|at\s+most|no\s+more\s+than|not\s+more\s+than|up\s+to)\s*(\d[\d,]*)\s*(?:words?)?\b/i

/**
 * Best-effort parse of "800-1,000 words" (and friends) out of free-text
 * instructions. Legacy instruction sets carry the length here rather than in
 * dedicated columns; this reads it so those sets keep working after the
 * schema change.
 */
export function fromInstructionText(text: string): LengthTarget | null {
  const t = text || ''

  const range = t.match(RANGE_WORDS)
  if (range) {
    const min = num(range[1])
    const max = num(range[2])
    if (min && max) return normalise({ min: Math.min(min, max), max: Math.max(min, max), target: Math.round((min + max) / 2) })
  }

  const minMatch = t.match(MIN_ONLY)
  const maxMatch = t.match(MAX_ONLY)
  if (minMatch && maxMatch) {
    const min = num(minMatch[1])
    const max = num(maxMatch[1])
    if (min && max) return normalise({ min: Math.min(min, max), max: Math.max(min, max), target: Math.round((min + max) / 2) })
  }
  if (minMatch) {
    const min = num(minMatch[1])
    if (min) return normalise({ min, target: Math.round(min * 1.1), max: Math.round(min * 1.25) })
  }
  if (maxMatch) {
    const max = num(maxMatch[1])
    if (max) return normalise({ min: Math.round(max * 0.75), target: Math.round(max * 0.9), max })
  }

  const single = t.match(SINGLE_WORDS)
  if (single) {
    const target = num(single[1])
    // A bare "5" or "10" almost always refers to a heading count or a list
    // length, not the article body — ignore anything implausibly small.
    if (target && target >= 200) {
      return normalise({ min: Math.round(target * 0.9), target, max: Math.round(target * 1.1) })
    }
  }

  return null
}

/**
 * The single call sites should use: explicit columns win; text is the
 * fallback so the switchover does not break sets saved before the migration.
 */
export function resolveLengthTarget(
  row: { min_words?: number | null; target_words?: number | null; max_words?: number | null; instructions?: string | null } | null | undefined
): LengthTarget | null {
  if (!row) return null
  const explicit = fromExplicitColumns(row)
  if (explicit) return explicit
  return fromInstructionText(row.instructions || '')
}

function num(v: string): number {
  return parseInt(v.replace(/,/g, ''), 10) || 0
}

function intOrNull(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n > 0 ? n : null
}

function normalise(l: LengthTarget): LengthTarget {
  const clamp = (n: number) => Math.max(1, Math.min(MAX_ARTICLE_WORDS, Math.round(n)))
  const min = clamp(l.min)
  const max = clamp(l.max)
  const target = clamp(Math.max(min, Math.min(max, l.target)))
  return { min: Math.min(min, target), target, max: Math.max(max, target) }
}
