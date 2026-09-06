import { MAX_ARTICLE_WORDS } from '@/lib/instruction-limits'
import { readUsage, type UsageInfo } from '@/lib/ai-cost'
import type { LengthTarget } from '@/lib/article-length'

export const AVAILABLE_MODELS = [
  { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', badge: 'Best' },
  { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5', badge: 'Fast' },
  { id: 'openai/gpt-4o', name: 'GPT-4o', badge: '' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', badge: 'Fast' },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', badge: 'Fast' },
  // Not free — these are the paid variants. The picker shows live per-token
  // pricing next to the badge, so "Free" read as a contradiction.
  { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', badge: 'Budget' },
  { id: 'mistralai/mistral-small-3.1-24b-instruct', name: 'Mistral Small 3.1', badge: 'Budget' },
]

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'

// Models often emit a meta description alongside the body despite being asked
// for body HTML only. Lift it out so it lands in the Yoast field instead of
// being published inside the post.
const META_LABEL = String.raw`(?:seo\s*)?meta[\s\-_]*descriptions?`
const EMPHASIS = String.raw`(?:strong|b|em|i)`

// Only trust the label at the very top or bottom of the output — an article
// *about* SEO can legitimately discuss meta descriptions mid-body.
const EDGE_WINDOW = 500

// Shortest string we'll accept as a real meta description rather than a stray label
const MIN_META_LENGTH = 20

const META_PATTERNS: RegExp[] = [
  // <h2>Meta Description</h2><p>…</p>
  // No capture group on the tag — every pattern here must expose the description
  // as group 1.
  new RegExp(
    String.raw`<h[1-6][^>]*>\s*(?:\*\*)?\s*${META_LABEL}\s*:?\s*(?:\*\*)?\s*</h[1-6]>\s*<p[^>]*>([\s\S]*?)</p>`,
    'i'
  ),
  // <p><strong>Meta Description:</strong></p><p>…</p>
  new RegExp(
    String.raw`<p[^>]*>\s*(?:<${EMPHASIS}>)?\s*(?:\*\*)?\s*${META_LABEL}\s*:?\s*(?:\*\*)?\s*(?:</${EMPHASIS}>)?\s*:?\s*</p>\s*<p[^>]*>([\s\S]*?)</p>`,
    'i'
  ),
  // <p><strong>Meta Description:</strong> …</p> — emphasis tag and colon in either order
  new RegExp(
    String.raw`<p[^>]*>\s*(?:<${EMPHASIS}>)?\s*(?:\*\*)?\s*${META_LABEL}\s*:?\s*(?:\*\*)?\s*(?:</${EMPHASIS}>)?\s*:?\s*([\s\S]*?)</p>`,
    'i'
  ),
  // <!-- Meta Description: … -->
  new RegExp(String.raw`<!--\s*${META_LABEL}\s*:?\s*([\s\S]*?)-->`, 'i'),
  // Bare or markdown-ish line before any tag: **Meta Description:** …
  new RegExp(
    String.raw`^[^\S\n]*(?:\*\*)?[^\S\n]*${META_LABEL}[^\S\n]*:[^\S\n]*(?:\*\*)?[^\S\n]*(.+)$`,
    'im'
  ),
]

function htmlToText(input: string): string {
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Splits a leading/trailing meta description off the generated body.
 * Returns the body with it removed, plus the description when one was found.
 */
export function extractMetaDescription(html: string): {
  content: string
  metaDescription: string | null
} {
  for (const pattern of META_PATTERNS) {
    const match = html.match(pattern)
    if (!match || match.index === undefined) continue

    const atStart = match.index <= EDGE_WINDOW
    const atEnd = match.index + match[0].length >= html.length - EDGE_WINDOW
    if (!atStart && !atEnd) continue

    const text = htmlToText(match[1] || '')
    if (text.length < MIN_META_LENGTH) continue

    const content = (html.slice(0, match.index) + html.slice(match.index + match[0].length)).trim()
    return { content, metaDescription: text }
  }

  return { content: html.trim(), metaDescription: null }
}

export async function generateTopic(
  apiKey: string,
  model: string,
  prompt: string
): Promise<{ title: string; keywords: string[] }> {
  const res = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://zaoflo.com',
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: `Based on this content strategy: "${prompt}"\n\nGenerate a specific, unique, SEO-friendly article title and 3-5 target keywords.\nReturn ONLY valid JSON: {"title": "...", "keywords": ["...", "..."]}`,
      }],
      max_tokens: 200,
      response_format: { type: 'json_object' },
    }),
  })
  const data = await res.json()
  const content = data.choices?.[0]?.message?.content || '{}'
  try { return JSON.parse(content) } catch { return { title: prompt.slice(0, 80), keywords: [] } }
}

export type CityFocus = '100' | '50' | '10'

export interface GenerateArticleResult {
  content: string
  wordCount: number
  excerpt: string
  metaDescription: string
  /** Non-null when the model put a meta description in the body and we lifted it out */
  extractedMetaDescription: string | null
  /** True when the length gate rejected the first draft and we re-prompted. */
  lengthRetried: boolean
  /** True when the final draft is still outside the requested min–max range. */
  lengthOutOfRange: boolean
}

export async function generateArticle({
  apiKey,
  model,
  title,
  keywords = [],
  focusKeyword,
  instructions,
  knowledgeBase,
  length,
  city,
  cityFocus,
  onUsage,
}: {
  apiKey: string
  model: string
  title: string
  keywords?: string[]
  focusKeyword?: string
  instructions?: string
  /** Free-text brief on the company/site the article is being written for. */
  knowledgeBase?: string
  /** Explicit min/target/max — promotes length to a hard rule and drives the
   *  post-generation retry. When absent the prompt keeps its old defaults. */
  length?: LengthTarget | null
  /** Geographic anchor — how prominent the city should be is `cityFocus`. */
  city?: string
  cityFocus?: CityFocus
  /** Fires once after a successful call so the caller can bill the tokens.
   *  Called again on the length-retry attempt — the caller should sum. */
  onUsage?: (u: UsageInfo) => void
}): Promise<GenerateArticleResult> {
  const systemPrompt = `You are an expert SEO content writer who creates high-quality, comprehensive blog posts.
Your articles are well-structured with proper HTML, engaging, and optimized for search engines while remaining genuinely helpful for readers.
Always output clean HTML without any markdown code blocks or document tags — just the article body HTML.`

  const userPrompt = buildArticlePrompt({ title, keywords, focusKeyword, instructions, knowledgeBase, length, city, cityFocus })

  const first = await callModel({ apiKey, model, systemPrompt, userPrompt, onUsage })

  // Instructions alone don't get every model to the requested length. When
  // there's an explicit target, verify and re-prompt once if the draft is
  // outside the range. One retry caps the cost while catching the models
  // that ignore the ask on the first try.
  if (length && (first.wordCount < length.min || first.wordCount > length.max)) {
    const correction = buildLengthCorrectionPrompt(userPrompt, first.content, first.wordCount, length)
    const second = await callModel({ apiKey, model, systemPrompt, userPrompt: correction, onUsage })
    return {
      ...second,
      lengthRetried: true,
      lengthOutOfRange: second.wordCount < length.min || second.wordCount > length.max,
    }
  }

  return { ...first, lengthRetried: false, lengthOutOfRange: false }
}

async function callModel({
  apiKey, model, systemPrompt, userPrompt, onUsage,
}: {
  apiKey: string
  model: string
  systemPrompt: string
  userPrompt: string
  onUsage?: (u: UsageInfo) => void
}): Promise<Omit<GenerateArticleResult, 'lengthRetried' | 'lengthOutOfRange'>> {
  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://zaoflo.com',
      'X-Title': 'Zaoflo - AI WordPress Publisher',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 4096,
      temperature: 0.7,
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    if (response.status === 401 || response.status === 403) {
      throw new Error('Invalid OpenRouter API key. Go to Settings and update it.')
    }
    if (response.status === 402) {
      throw new Error('Your OpenRouter account has no credits. Add credits at openrouter.ai.')
    }
    throw new Error(err?.error?.message || `OpenRouter error: ${response.status}`)
  }

  const data = await response.json()
  onUsage?.(readUsage(data, model))
  const rawContent: string = data.choices?.[0]?.message?.content || ''

  const { content, metaDescription: extracted } = extractMetaDescription(rawContent)

  const plainText = htmlToText(content)
  const excerpt = plainText.slice(0, 300) + (plainText.length > 300 ? '...' : '')
  const metaDescription =
    extracted || plainText.slice(0, 155) + (plainText.length > 155 ? '...' : '')
  const wc = plainText.split(/\s+/).filter(Boolean).length

  return { content, wordCount: wc, excerpt, metaDescription, extractedMetaDescription: extracted }
}

function buildLengthCorrectionPrompt(
  originalPrompt: string,
  previousDraft: string,
  previousWordCount: number,
  length: LengthTarget,
): string {
  const direction = previousWordCount > length.max ? 'too long' : 'too short'
  return `${originalPrompt}

Your previous draft was ${direction} — it came out at ${previousWordCount.toLocaleString('en-US')} words, but the article MUST be between ${length.min.toLocaleString('en-US')} and ${length.max.toLocaleString('en-US')} words (aim for ${length.target.toLocaleString('en-US')}).

Rewrite the article from scratch to fit the range exactly. ${
    previousWordCount > length.max
      ? 'Cut sections, tighten paragraphs, and remove filler — do not just chop off the ending. Every section must still reach a natural close.'
      : 'Add depth to each section — worked examples, specifics, a second angle — rather than padding the intro or conclusion.'
  } Output only the HTML body, same rules as before.

For reference, this was your previous draft (do NOT copy it verbatim — rewrite):
${previousDraft.slice(0, 4000)}`
}

function cityInstruction(city: string, focus: CityFocus): string {
  const c = city.trim()
  if (focus === '100') {
    return `Geographic focus (heavy): The article is anchored to ${c}. The WordPress post title above already carries "${c}" — mirror that in the article body by mentioning ${c} multiple times (roughly one reference per 300 words, without keyword-stuffing) and by devoting at least one <h2> section to something specific to ${c} (a local example, statistic, venue, or regulation).`
  }
  if (focus === '50') {
    return `Geographic context (moderate): Reference ${c} in the intro paragraph and in the text of the first <h2>. Return to it in another two or three places across the body so a reader can tell the article is written with ${c} in mind, without letting the city crowd out the subject.`
  }
  return `Geographic flavour (subtle): Mention ${c} once or twice in the body, casually — as an example, a passing reference, or a closing note. Do not lead with it; it is not the main subject.`
}

function buildArticlePrompt({
  title,
  keywords,
  focusKeyword,
  instructions,
  knowledgeBase,
  length,
  city,
  cityFocus,
}: {
  title: string
  keywords: string[]
  focusKeyword?: string
  instructions?: string
  knowledgeBase?: string
  length?: LengthTarget | null
  city?: string
  cityFocus?: CityFocus
}): string {
  let prompt = `Write a comprehensive, SEO-optimized blog post for the following WordPress post title:\n\n"${title}"\n\n`

  // Capped at 4,000 chars for the same reason the idea prompt caps it: a very
  // long brief must not push the article rules or the author's instructions
  // out of the model's context window.
  const brief = (knowledgeBase || '').trim()
  if (brief) {
    prompt += `About the company / brief the article must sit inside:\n${brief.slice(0, 4000)}\n\n`
  }

  if (city && city.trim() && cityFocus) {
    prompt += `${cityInstruction(city, cityFocus)}\n\n`
  }

  if (focusKeyword) {
    prompt += `Focus keyword: ${focusKeyword}\n`
  }
  if (keywords.length > 0) {
    prompt += `Secondary keywords to naturally include: ${keywords.join(', ')}\n`
  }

  const authorInstructions = instructions?.trim() || ''
  const hasAuthorInstructions = authorInstructions.length > 0

  // When a length target is set, it becomes a hard rule and the default
  // length/structure block is dropped — the old prompt had both, so a
  // "target 800–1,000" author instruction had to fight a "target 1,500–1,800"
  // default. The result was models anchoring on the bigger number.
  const lengthRule = length
    ? `- Article length MUST be between ${length.min.toLocaleString('en-US')} and ${length.max.toLocaleString('en-US')} words, aiming for ${length.target.toLocaleString('en-US')}. This overrides every other length signal below and is checked after generation`
    : `- NEVER exceed ${MAX_ARTICLE_WORDS.toLocaleString('en-US')} words total. If anything below asks for more, write ${MAX_ARTICLE_WORDS.toLocaleString('en-US')} words and make sure the article still reaches a complete conclusion`

  prompt += `
Hard rules (never break these):
${lengthRule}
- The WordPress post title is used as the page <h1>, so DO NOT include any <h1> tag in your output — start the body with an <h2>
- Use proper HTML tags: <h2>, <h3> for headings; <p> for paragraphs; <ul>/<ol>/<li> for lists; <strong>/<em> for emphasis
- Focus keyword must appear in the intro paragraph AND in the text of the first <h2>
- Write naturally — avoid keyword stuffing
- Use transition words and vary sentence length for readability
- Output the article body ONLY. Do NOT write a meta description, SEO summary, excerpt, or any labelled front-matter such as "Meta Description:" — those fields are generated separately and anything like that here ends up published inside the post
`

  // Only emit the section-by-section structural defaults when the caller has
  // not pinned a length. With a pinned range those numbers would push the
  // model past the max — 3-5 sections at 300-400 words each is already 900-2000.
  if (!length) {
    prompt += `
Defaults${hasAuthorInstructions ? " — follow these ONLY where the author's instructions below do not say otherwise" : ''}:
- Target length: 1,500–1,800 words total
- Structure:
  1. Intro section (150–200 words): hook the reader, state the problem, and explain what they will learn — written as <p> tags, no heading
  2. 3–5 main <h2> sections (300–400 words each), with 1–2 <h3> subsections per <h2> where they fit naturally
  3. A final <h2> "Conclusion" or call-to-action section (150–200 words)
- Include bulleted or numbered lists where they add clarity — at least one list in the article
- Do NOT use <h4> or deeper heading tags
`
  } else {
    // When the length is pinned, still give minimal structural guidance so a
    // 500-word article does not come back as one giant paragraph, but scale
    // it so it fits the target rather than dictating a fixed section count.
    prompt += `
Structure (fit these to the length range above):
- Open with a short intro (roughly 10–15% of the target) as <p> tags with no heading
- Break the body into <h2> sections sized to the total — a short article may only need 2 sections, a long one 4–5
- Close with a brief conclusion or call-to-action <h2> (roughly 10–15% of the target)
- Add at least one bulleted or numbered list where it adds clarity
- Do NOT use <h4> or deeper heading tags
`
  }

  if (hasAuthorInstructions) {
    prompt += `
AUTHOR'S INSTRUCTIONS — these take priority over the defaults above, but never over the hard rules.
Where they specify heading structure, tone, or format, follow them exactly.
If they ask for a single <h1>, that requirement is already satisfied by the WordPress post title — still do not emit an <h1> tag yourself.

${authorInstructions}
`
  }

  prompt += `\nOutput ONLY the HTML body content, starting with the first <p> of the intro. Do not include <html>, <head>, <body>, <h1>, any code block wrappers, or a "Meta Description:" line.`

  return prompt
}

export interface RejectedIdea {
  title: string
  keywords?: string[]
}

/**
 * Suggests one article the site has not covered yet, given its back catalogue,
 * knowledge base, and anything already turned down. Returns a proposal, not a
 * body — the article itself is written later by `generateArticle`.
 *
 * `onUsage` fires once per model call so the caller can sum retries and bill
 * them together.
 */
export async function generateArticleIdea({
  apiKey,
  model,
  existingTitles,
  siteName,
  knowledgeBase,
  topic,
  rejectedIdeas,
  city,
  cityFocus,
  onUsage,
}: {
  apiKey: string
  model: string
  existingTitles: string[]
  siteName: string
  knowledgeBase: string
  topic: string
  rejectedIdeas: RejectedIdea[]
  /** Geographic anchor for the idea — steer only, the title is the model's. */
  city?: string
  cityFocus?: CityFocus
  onUsage?: (u: UsageInfo) => void
}): Promise<{ title: string; description: string; keywords: string[] }> {
  const prompt = buildIdeaPrompt({
    siteName, knowledgeBase, topic, existingTitles, rejectedIdeas, city, cityFocus,
  })

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://zaoflo.com',
      'X-Title': 'Zaoflo - AI WordPress Publisher',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    if (response.status === 401 || response.status === 403) {
      throw new Error('Invalid OpenRouter API key. Go to Settings and update it.')
    }
    if (response.status === 402) {
      throw new Error('Your OpenRouter account has no credits. Add credits at openrouter.ai.')
    }
    throw new Error(err?.error?.message || `OpenRouter error: ${response.status}`)
  }

  const data = await response.json()
  onUsage?.(readUsage(data, model))

  const raw: string = data.choices?.[0]?.message?.content || '{}'
  // Some models still wrap JSON in ```json fences even with response_format set.
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  let parsed: { title?: unknown; description?: unknown; keywords?: unknown } = {}
  try { parsed = JSON.parse(cleaned) } catch {}

  const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
  const description = typeof parsed.description === 'string' ? parsed.description.trim() : ''
  const keywords = Array.isArray(parsed.keywords)
    ? parsed.keywords
        .filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
        .map((k) => k.trim())
        .slice(0, 10)
    : []

  // An empty title would render as a blank card — better to fail loudly so the
  // caller can retry or switch models.
  if (!title) {
    throw new Error('Model did not return a usable idea. Try again or switch models.')
  }

  return { title, description, keywords }
}

function ideaCityInstruction(city: string, focus: CityFocus): string {
  const c = city.trim()
  if (focus === '100') {
    return `Geographic focus (heavy): The proposed article is anchored to ${c}. The title MUST include "${c}" verbatim. Keywords should include at least one ${c}-specific phrase.`
  }
  if (focus === '50') {
    return `Geographic context (moderate): The article should be written with ${c} in mind — reflect that in the description. The title does not need to include "${c}"; keywords may.`
  }
  return `Geographic flavour (subtle): ${c} is a passing reference, not the subject. Do not put it in the title. Description may allude to it once.`
}

function buildIdeaPrompt({
  siteName,
  knowledgeBase,
  topic,
  existingTitles,
  rejectedIdeas,
  city,
  cityFocus,
}: {
  siteName: string
  knowledgeBase: string
  topic: string
  existingTitles: string[]
  rejectedIdeas: RejectedIdea[]
  city?: string
  cityFocus?: CityFocus
}): string {
  const parts: string[] = [
    `You are proposing one article for the blog of "${siteName}".`,
  ]

  if (city && city.trim() && cityFocus) {
    parts.push(ideaCityInstruction(city, cityFocus))
  }

  // A typed topic is the primary instruction. Lead with it so the model
  // sees it before the knowledge base or the back catalogue drown it out --
  // burying the ask three sections deep is why the model kept picking a
  // different subject from the brief instead of writing to the request.
  if (topic) {
    parts.push(
      `THE AUTHOR HAS ALREADY CHOSEN THE SUBJECT. Write the idea about this exact topic and nothing else:

"${topic}"

Rules for this topic:
- The title, description, and keywords must all be about this exact topic.
- Do NOT substitute a different subject, even if it seems more original, more search-friendly, or a better fit for the site.
- Do NOT pick an adjacent or related topic. If the ask is narrow, keep the idea narrow.
- If nothing in the company brief below fits the topic, ignore the brief for subject choice and use it only to match tone.`
    )
  }

  if (knowledgeBase) {
    // Capped so a very long brief cannot push the back-catalogue or the JSON
    // instructions out of the model's context window.
    parts.push(`About the company / brief:\n${knowledgeBase.slice(0, 4000)}`)
  }

  if (!topic) {
    parts.push(
      `No specific topic was requested — pick a subject this site has not written about that fits the brief and would earn organic search traffic.`
    )
  }

  if (existingTitles.length > 0) {
    // Recent titles matter more than ancient ones for "don't repeat yourself".
    const shown = existingTitles.slice(-80)
    const framing = topic
      // With a typed topic the guardrail relaxes to angle-differentiation:
      // the user may well be asking to revisit a subject deliberately, and
      // rejecting the ask because a loosely-similar title exists is the
      // failure mode this branch is meant to avoid.
      ? `Titles already on this site (write to the requested topic; if it overlaps, pick a genuinely different angle rather than switching subject):`
      : `Already covered on this site (do not duplicate or paraphrase):`
    parts.push(`${framing}\n${shown.map((t) => `- ${t}`).join('\n')}`)
  }

  if (rejectedIdeas.length > 0) {
    const shown = rejectedIdeas.slice(-40)
    parts.push(
      `Already turned down (do not suggest again; steer away from close variants):\n${shown
        .map((r) => `- ${r.title}${r.keywords?.length ? ` [${r.keywords.join(', ')}]` : ''}`)
        .join('\n')}`
    )
  }

  // Repeating the ask right before the JSON schema so it is the last thing
  // the model reads before generating — models weight recency and the JSON
  // instructions were previously the only nearby signal.
  if (topic) {
    parts.push(
      `Reminder: the idea must be about this exact topic — "${topic}". Do not switch subjects.`
    )
  }

  parts.push(`Return ONLY valid JSON with exactly these keys:
{
  "title": "Article title (60-80 chars, specific and search-friendly, no clickbait, no year)",
  "description": "1-2 sentence pitch of the angle — what the article covers and why it matters (max 240 chars)",
  "keywords": ["3-6 target keywords or phrases the article should rank for"]
}
No prose, no markdown, no code fences.`)

  return parts.join('\n\n')
}

// Converts any string to a URL slug, never cutting mid-word.
// Removes stop words first to save space, then drops trailing complete words until ≤ maxLen.
function safeSlug(input: string, maxLen = 60): string {
  const STOP = /^(the|a|an|is|are|was|were|be|been|being|do|does|did|have|has|had|will|would|could|should|may|might|shall|can|need|dare|ought|used|to|of|in|on|at|for|with|by|from|up|about|into|through|during|before|after|above|below|between|out|off|over|under|again|then|once|here|there|when|where|why|how|all|both|each|few|more|most|other|some|such|no|not|only|own|same|so|than|too|very|just|but|and|or|nor|yet|so|if|as|because|although|though|unless|until|while|what|which|who|whom|whose|this|that|these|those|your|my|our|their|his|her|its|you|we|they|he|she|it|i|me|him|us|them)$/i

  const raw = input
    .toLowerCase()
    .replace(/['']/g, '')          // smart quotes
    .replace(/[^a-z0-9\s-]/g, ' ') // strip non-alphanumeric
    .trim()

  // Build word list, filtering stop words
  const allWords = raw.split(/\s+/).filter(Boolean)
  const words = allWords.filter((w) => !STOP.test(w))
  const base = words.length > 0 ? words : allWords // fall back if all were stop words

  // Join and truncate at word boundary
  let slug = base.join('-')
  if (slug.length <= maxLen) return slug

  // Drop words from the end until it fits (never slice mid-word)
  const parts = [...base]
  while (parts.length > 1 && parts.join('-').length > maxLen) {
    parts.pop()
  }
  return parts.join('-')
}

export interface SEOMeta {
  focusKeyphrase: string
  keyphraseSynonyms: string
  yoastTitle: string
  yoastMetaDescription: string
  slug: string
}

/**
 * The five Yoast fields must never leave this codebase blank. The article
 * generator lands them via one prompt; retries fill the ones the model
 * skipped; and this final pass covers everything the retries missed —
 * whitespace, missing keys, models that dropped a field.
 *
 * Every fallback is derived from the article itself (title, keywords, body)
 * rather than a placeholder, so a shipped article that hits this fallback
 * still reads as though it were written for.
 */
export function fillSeoBlanks(
  seo: Partial<SEOMeta> | null | undefined,
  { title, keywords, contentText }: { title: string; keywords: string[]; contentText: string },
): SEOMeta {
  const titleWords = title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean)
  const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const focusKeyphrase =
    clean(seo?.focusKeyphrase) || keywords[0] || titleWords.slice(0, 3).join(' ') || title
  const keyphraseSynonyms =
    clean(seo?.keyphraseSynonyms) || keywords[1] || titleWords.slice(-3).join(' ') || focusKeyphrase
  const yoastTitle = (clean(seo?.yoastTitle) || title).slice(0, 60)
  const yoastMetaDescription =
    (clean(seo?.yoastMetaDescription) || contentText.slice(0, 155) || title).slice(0, 160)
  const slug =
    (clean(seo?.slug) || titleWords.slice(0, 8).join('-') || 'article').slice(0, 60)
  return { focusKeyphrase, keyphraseSynonyms, yoastTitle, yoastMetaDescription, slug }
}

export async function generateSEOMeta(
  apiKey: string,
  model: string,
  title: string,
  content: string,
  keywords: string[],
  onUsage?: (u: UsageInfo) => void,
): Promise<SEOMeta> {
  const plainContent = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

  const prompt = `You are an SEO expert. Return ONLY a valid JSON object with EXACTLY these 5 keys for the article below.

RULES:
- focusKeyphrase: 2-4 word phrase someone would Google to find this article. Based on SEARCH INTENT. NOT stop words (do/the/how/you/is/your). Example: "copyright protection" or "email marketing tips"
- keyphraseSynonyms: A DIFFERENT 2-4 word phrase covering the same topic. Example: "copyright ownership" or "intellectual property rights". NOT random words or stop words.
- yoastTitle: SEO title between 50-60 characters (count carefully including spaces)
- yoastMetaDescription: Meta description between 155-160 characters (count carefully)
- slug: URL slug — lowercase hyphenated, max 60 chars. CRITICAL: every word must be fully spelled out, no mid-word cuts. Remove stop words (the/a/is/how/your/do) to stay under 60. Example bad: "copyright-protectio" (cut off). Example good: "copyright-protection-creative-work"

Article title: ${title}
Keywords: ${keywords.join(', ')}
Content: ${plainContent.slice(0, 800)}

Return ONLY the JSON, no markdown, no explanation. Example format:
{"focusKeyphrase":"copyright protection","keyphraseSynonyms":"copyright ownership","yoastTitle":"How Copyright Protection Works for Creatives","yoastMetaDescription":"Learn how copyright protection works...","slug":"copyright-protection-creative-work"}`

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://zaoflo.com',
      'X-Title': 'Zaoflo - AI WordPress Publisher',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400,
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    if (response.status === 401 || response.status === 403) {
      throw new Error('Invalid OpenRouter API key. Go to Settings and update it.')
    }
    if (response.status === 402) {
      throw new Error('Your OpenRouter account has no credits. Add credits at openrouter.ai.')
    }
    throw new Error(err?.error?.message || `OpenRouter error: ${response.status}`)
  }

  const data = await response.json()
  onUsage?.(readUsage(data, model))
  const raw = data.choices?.[0]?.message?.content || '{}'

  // Strip markdown code fences that some models wrap around JSON
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  try {
    const parsed = JSON.parse(cleaned) as SEOMeta

    parsed.yoastTitle = parsed.yoastTitle || title
    parsed.slug = safeSlug(parsed.slug || title)

    // Yoast flags a title over 60 characters as too long; clamp on a word
    // boundary rather than a raw slice so we do not chop the last word in half.
    if (parsed.yoastTitle.length > 60) {
      const trimmed = parsed.yoastTitle.slice(0, 60)
      const cut = trimmed.lastIndexOf(' ')
      parsed.yoastTitle = (cut > 40 ? trimmed.slice(0, cut) : trimmed).trim()
    }

    if ((parsed.yoastMetaDescription || '').length > 160) {
      parsed.yoastMetaDescription = parsed.yoastMetaDescription.slice(0, 160)
    }

    // Ensure keyphrase fields are never empty — extract from keywords or title as fallback
    if (!parsed.focusKeyphrase) {
      parsed.focusKeyphrase = keywords[0] || title.split(' ').slice(0, 3).join(' ').toLowerCase()
    }
    if (!parsed.keyphraseSynonyms) {
      parsed.keyphraseSynonyms = keywords[1] || keywords[0] || title.split(' ').slice(-3).join(' ').toLowerCase()
    }

    return parsed
  } catch {
    return {
      focusKeyphrase: keywords[0] || title.split(' ').slice(0, 3).join(' ').toLowerCase(),
      keyphraseSynonyms: keywords[1] || title.split(' ').slice(-3).join(' ').toLowerCase(),
      yoastTitle: title.slice(0, 60),
      yoastMetaDescription: plainContent.slice(0, 155),
      slug: safeSlug(title),
    }
  }
}
