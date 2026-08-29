// The article generation call is capped at max_tokens: 4096 (see openrouter.ts).
// That is roughly 2,500 words of HTML — asking for more produces an article that
// gets truncated mid-sentence, so instruction sets are validated against this ceiling.
export const MAX_ARTICLE_WORDS = 2500

// "2,500 words", "3000 word article", "1500-2000 words", "3k words"
const NUMBER_THEN_WORDS =
  /(\d[\d,]*(?:\.\d+)?\s*k?\b(?:\s*(?:to|-|–|—|and|or)\s*\d[\d,]*(?:\.\d+)?\s*k?\b)?)[^.\n]{0,20}?\bwords?\b/gi

// "word count: 3000", "length of 3000", "at least 3000 long"
const WORDS_THEN_NUMBER =
  /\b(?:word\s*count|length|long)\b[^.\n]{0,20}?(\d[\d,]*(?:\.\d+)?\s*k?)\b/gi

const NUMBER_TOKEN = /(\d[\d,]*(?:\.\d+)?)\s*(k)?/gi

function largestOverLimit(fragment: string): number | null {
  let worst: number | null = null
  for (const token of fragment.matchAll(NUMBER_TOKEN)) {
    const base = parseFloat(token[1].replace(/,/g, ''))
    if (!Number.isFinite(base)) continue
    const value = token[2] ? base * 1000 : base
    if (value > MAX_ARTICLE_WORDS && (worst === null || value > worst)) worst = value
  }
  return worst
}

/**
 * Returns the largest requested word count that exceeds MAX_ARTICLE_WORDS,
 * or null when the text stays within the cap.
 */
export function findExcessiveWordCount(text: string): number | null {
  let worst: number | null = null
  for (const pattern of [NUMBER_THEN_WORDS, WORDS_THEN_NUMBER]) {
    // matchAll needs a fresh lastIndex per call — the regexes are module-level and global
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      const found = largestOverLimit(match[1])
      if (found !== null && (worst === null || found > worst)) worst = found
    }
  }
  return worst
}

export function wordCountLimitError(text: string): string | null {
  const found = findExcessiveWordCount(text)
  if (found === null) return null
  return `These instructions ask for ${found.toLocaleString()} words, but articles are capped at ${MAX_ARTICLE_WORDS.toLocaleString()} words — anything longer gets cut off mid-article. Lower the word count to continue.`
}
