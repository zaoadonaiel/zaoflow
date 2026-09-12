import type { SupabaseClient } from '@supabase/supabase-js'
import { parseCity, enforceCityDisplayInHtml } from '@/lib/seo-city-swap'
import { readUsage, recordUsage, type UsageRecord } from '@/lib/ai-cost'

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
export const VALID_SIMILARITIES = [10, 25, 50, 90] as const
export type Similarity = (typeof VALID_SIMILARITIES)[number]

function htmlToText(input: string): string {
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Order matters: broadest first so `<script>…</script>` gets captured whole
// before we start pulling out individual tags. Placeholders replace each
// match so the model only ever sees visible prose. Fusion Builder pages are
// mostly `[fusion_*]` shortcodes wrapping tiny amounts of text — the model
// used to try to "clean up" those shortcodes and strip half the page. Now it
// literally cannot touch them: they're not in the prompt.
const PROTECT_PATTERNS: RegExp[] = [
  /<!--[\s\S]*?-->/g,
  /<script\b[^>]*>[\s\S]*?<\/script>/gi,
  /<style\b[^>]*>[\s\S]*?<\/style>/gi,
  /<[^>]+>/g,
  /\[\/?[a-zA-Z_][^\]]*\]/g,
  /&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/g,
]

// U+27E6 / U+27E7 — math white square brackets. Single codepoints that are
// exceptionally rare in prose so the model won't mistake real text for a
// placeholder or vice versa.
const PLACEHOLDER_OPEN = '⟦'
const PLACEHOLDER_CLOSE = '⟧'
const PLACEHOLDER_RE = new RegExp(`${PLACEHOLDER_OPEN}P(\\d+)${PLACEHOLDER_CLOSE}`, 'g')

function makePlaceholder(id: number): string {
  return `${PLACEHOLDER_OPEN}P${id}${PLACEHOLDER_CLOSE}`
}

export function protectMarkup(input: string): { skeleton: string; protectedList: string[] } {
  // Pass 1 — extract in pattern order (broadest first: comments, script,
  // style, tags, shortcodes, entities). Each pattern is applied to the whole
  // string in turn, so ids at this stage are grouped by pattern, not by
  // position in the source.
  const rawProtected: string[] = []
  let current = input
  for (const pattern of PROTECT_PATTERNS) {
    current = current.replace(pattern, (match) => {
      const id = rawProtected.length
      rawProtected.push(match)
      return `${PLACEHOLDER_OPEN}R${id}${PLACEHOLDER_CLOSE}`
    })
  }

  // Pass 2 — renumber so placeholders appear in ascending order (P0, P1, P2,
  // …) in reading order. verifyPlaceholders relies on this: the model is
  // told "each PN appears exactly once, sequentially" so reordering,
  // duplication, or drops all show up as an ordering mismatch.
  const rawRe = new RegExp(`${PLACEHOLDER_OPEN}R(\\d+)${PLACEHOLDER_CLOSE}`, 'g')
  const protectedList: string[] = []
  const skeleton = current.replace(rawRe, (_, rawIdStr: string) => {
    const rawId = parseInt(rawIdStr, 10)
    const newId = protectedList.length
    protectedList.push(rawProtected[rawId])
    return makePlaceholder(newId)
  })

  return { skeleton, protectedList }
}

export function restoreMarkup(skeleton: string, protectedList: string[]): string {
  return skeleton.replace(PLACEHOLDER_RE, (_, idStr: string) => {
    const id = parseInt(idStr, 10)
    return protectedList[id] ?? ''
  })
}

/**
 * Every placeholder id [0..N-1] must appear exactly once, in ascending order.
 * If the model drops, duplicates, or renumbers placeholders the reconstructed
 * HTML would be corrupt — we refuse the rewrite instead of publishing broken
 * markup.
 */
export function verifyPlaceholders(rewritten: string, expectedCount: number): string | null {
  const ids: number[] = []
  for (const m of rewritten.matchAll(PLACEHOLDER_RE)) {
    ids.push(parseInt(m[1], 10))
  }
  if (ids.length !== expectedCount) {
    return `The rewrite dropped or duplicated some HTML/shortcode markers (expected ${expectedCount}, got ${ids.length}).`
  }
  const seen = new Set<number>()
  for (let i = 0; i < ids.length; i++) {
    if (seen.has(ids[i])) {
      return `The rewrite duplicated marker ${ids[i]}.`
    }
    seen.add(ids[i])
    if (ids[i] !== i) {
      return `The rewrite reordered the HTML/shortcode markers.`
    }
  }
  return null
}

function similarityBrief(pct: Similarity): string {
  switch (pct) {
    case 10:
      return `Aggressively rephrase every sentence. Only about 10% of the original wording should remain — swap sentence structures, replace verbs and nouns with synonyms, reorder clauses. The meaning stays; the wording changes almost completely.`
    case 25:
      return `Heavily rewrite every paragraph. Only about 25% of the original wording should remain — keep the point, but change most of the words, phrasings, and sentence shapes.`
    case 50:
      return `Rewrite about half of each paragraph. Keep roughly 50% of the original wording, replacing the rest with synonyms and alternative phrasings.`
    case 90:
      return `Lightly edit for freshness. Only about 10% of the wording should change — mostly small synonym swaps and minor phrasing tweaks. Keep sentences recognisable.`
  }
}

export interface RewriteResult {
  content: string
  originalWordCount: number
  newWordCount: number
  model: string
  similarity: Similarity
  usage: UsageRecord | null
}

/**
 * Shared rewrite implementation used by both the on-demand /rewrite route and
 * the Auto Post Trigger task. Keeps prompt drift from creeping in when either
 * caller is edited alone.
 */
export async function rewriteSeoContent({
  apiKey,
  content,
  model,
  similarity,
  instructions,
  targetCity,
  supabase,
  userId,
  seoPageId,
}: {
  apiKey: string
  content: string
  model: string
  similarity: Similarity
  instructions?: string
  targetCity?: string
  /** Passing these three records cost against the SEO page. Omit them
   *  (e.g. from a Trigger.dev context where the row doesn't exist yet) to
   *  skip cost logging entirely. */
  supabase?: SupabaseClient
  userId?: string
  seoPageId?: string | null
}): Promise<RewriteResult> {
  const originalWordCount = htmlToText(content).split(/\s+/).filter(Boolean).length
  const { skeleton, protectedList } = protectMarkup(content)
  const placeholderCount = protectedList.length

  const systemPrompt = `You are an expert SEO editor rewriting a location-cloned WordPress page so it is not a duplicate of the source. The input has every HTML tag and WordPress shortcode replaced with numbered placeholders like ${PLACEHOLDER_OPEN}P0${PLACEHOLDER_CLOSE}. You rewrite ONLY the prose between placeholders — you never touch, add, remove, reorder, or renumber a placeholder. You output ONLY the rewritten text, no code fences, no commentary.`

  const userPrompt = `Rewrite the text below.

HARD RULES — never break these:
- The text contains ${placeholderCount} placeholders numbered ${PLACEHOLDER_OPEN}P0${PLACEHOLDER_CLOSE} through ${PLACEHOLDER_OPEN}P${placeholderCount - 1}${PLACEHOLDER_CLOSE}. Output every placeholder EXACTLY as-is, in the same order and position. Do not add, remove, reorder, renumber, duplicate, or edit any placeholder. Each ${PLACEHOLDER_OPEN}PN${PLACEHOLDER_CLOSE} must appear exactly once.
- Placeholders represent HTML tags and WordPress shortcodes. Never invent new placeholders. Never write HTML tags (like <p>) or shortcodes (like [fusion_text]) yourself — they only exist as placeholders.
- Never change any city name. Keep every reference to "${targetCity || '<the target city>'}" exactly as written.
- Keep numbers, dates, URLs, emails, phone numbers, prices, and brand names untouched.
- Keep the total visible-word count within ±10% of the original (${originalWordCount} words).
- Output ONLY the rewritten text with placeholders intact. No code fences, no explanatory text.

REWRITE INSTRUCTION (${similarity}% similar to the source):
${similarityBrief(similarity)}
${instructions?.trim() ? `\nADDITIONAL AUTHOR INSTRUCTIONS (secondary to the hard rules):\n${instructions.trim()}\n` : ''}
Text to rewrite:
${skeleton}`

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://zaoflo.com',
      'X-Title': 'Zaoflo - SEO Pages',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      // similarity=10 needs the model free enough to actually diverge.
      temperature: similarity === 10 ? 0.9 : similarity === 25 ? 0.8 : similarity === 50 ? 0.7 : 0.5,
      max_tokens: 8000,
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err?.error?.message || `OpenRouter error: ${response.status}`)
  }

  const data = await response.json()
  const rawContent: string = data.choices?.[0]?.message?.content || ''

  const stripped = rawContent
    .trim()
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  const placeholderError = verifyPlaceholders(stripped, placeholderCount)
  if (placeholderError) {
    throw new Error(
      `${placeholderError} Try a lighter similarity, a stronger model, or re-run — the source HTML was preserved (nothing was overwritten).`,
    )
  }

  const restored = restoreMarkup(stripped, protectedList)

  const cleaned = targetCity
    ? enforceCityDisplayInHtml(restored, parseCity(targetCity))
    : restored

  const newWordCount = htmlToText(cleaned).split(/\s+/).filter(Boolean).length

  let usageRecord: UsageRecord | null = null
  if (supabase && userId) {
    const usage = readUsage(data, model || 'unknown')
    try {
      usageRecord = await recordUsage({
        supabase,
        userId,
        step: 'rewrite',
        usage,
        seoPageId: seoPageId ?? null,
      })
    } catch { /* best effort — cost logging shouldn't break a rewrite */ }
  }

  return {
    content: cleaned,
    originalWordCount,
    newWordCount,
    model,
    similarity,
    usage: usageRecord,
  }
}
