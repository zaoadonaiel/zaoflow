import { MAX_ARTICLE_WORDS } from '@/lib/instruction-limits'

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

import { readUsage, type UsageInfo } from './ai-cost'
import { knowledgeBaseBlock } from './knowledge-base'

/** Callers pass this to collect what each call cost them. Retries report each
 *  attempt separately, because each attempt is billed. */
export type UsageSink = (u: UsageInfo) => void

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'

/** What every text generation falls back to when the chosen one is gone. */
export const FALLBACK_TEXT_MODEL = AVAILABLE_MODELS[0].id

/**
 * One POST to OpenRouter, with the one retry worth making.
 *
 * A model id goes stale — retired by its provider, or saved as a default
 * months ago and no longer served — and OpenRouter answers every request with
 * "No endpoints found for <id>". Nothing about the article, the site or the
 * key is wrong, so failing the whole generation over it helps nobody: the
 * request is repeated on a model that exists.
 *
 * The model actually used comes back with the response, because the cost row
 * has to name what was really billed rather than what was asked for.
 */
async function postChat(
  apiKey: string,
  body: Record<string, unknown> & { model: string },
  extraHeaders: Record<string, string> = {}
): Promise<{ res: Response; modelUsed: string }> {
  const send = (payload: Record<string, unknown>) =>
    fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://zaoflo.com',
        ...extraHeaders,
      },
      body: JSON.stringify(payload),
    })

  const res = await send(body)
  if (res.ok || body.model === FALLBACK_TEXT_MODEL) return { res, modelUsed: body.model }

  const err = await res.clone().json().catch(() => ({}))
  const message: string = err?.error?.message || ''
  if (!/no endpoints found/i.test(message)) return { res, modelUsed: body.model }

  const retry = await send({ ...body, model: FALLBACK_TEXT_MODEL })
  return retry.ok
    ? { res: retry, modelUsed: FALLBACK_TEXT_MODEL }
    : { res, modelUsed: body.model }
}


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
  const { res } = await postChat(apiKey, {
      model,
      messages: [{
        role: 'user',
        content: `Based on this content strategy: "${prompt}"\n\nGenerate a specific, unique, SEO-friendly article title and 3-5 target keywords.\nReturn ONLY valid JSON: {"title": "...", "keywords": ["...", "..."]}`,
      }],
      max_tokens: 200,
      response_format: { type: 'json_object' },
  })
  const data = await res.json()
  const content = data.choices?.[0]?.message?.content || '{}'
  try { return JSON.parse(content) } catch { return { title: prompt.slice(0, 80), keywords: [] } }
}

export interface ArticleIdea {
  title: string
  description: string
  keywords: string[]
}

/** Loose match so "10 Best Sofas" and "The 10 best sofas!" count as the same idea. */
function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\b(the|a|an|for|to|of|in|and|your)\b/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Pulls the idea object out of a reply that may not be bare JSON.
 *
 * response_format is a request, not a guarantee: models that do not honour it
 * fence the JSON in ```json, or set a sentence either side of it. Both parse
 * fine once the wrapper is off, and refusing them threw away good ideas.
 */
function parseIdeaJson(raw: string): ArticleIdea | null {
  const text = raw.trim()
  if (!text) return null

  const unfenced = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  const candidates = [unfenced]
  // Prose either side of the object — take everything between the outermost braces.
  const open = unfenced.indexOf('{')
  const close = unfenced.lastIndexOf('}')
  if (open !== -1 && close > open) candidates.push(unfenced.slice(open, close + 1))

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed.title === 'string' && parsed.title.trim()) {
        return parsed as ArticleIdea
      }
    } catch {
      // Try the next shape rather than giving up on the whole attempt.
    }
  }
  return null
}

/** Why one attempt produced nothing, in words the user can act on. */
function attemptFailure(attempt: number, content: string, finishReason?: string): string {
  if (finishReason === 'length') {
    return `attempt ${attempt}: the reply hit the token limit and was cut off mid-JSON`
  }
  if (!content.trim()) {
    return `attempt ${attempt}: the model returned an empty reply (a reasoning model can spend its whole budget before answering — try a different model)`
  }
  return `attempt ${attempt}: the reply was not JSON — it began "${content.trim().slice(0, 60).replace(/\s+/g, ' ')}…"`
}

/**
 * Proposes an article that has not been written for this site yet.
 *
 * The model is given every existing title and told to avoid them, but models
 * drift, so the result is checked against the list and retried. Asking nicely is
 * not the same as the topic actually being new.
 */
/** An idea that was put in front of the user and turned down. */
export interface RejectedIdea {
  title: string
  keywords?: string[]
}

/** Enough for the model to see the pattern without the prompt running away. */
const MAX_REJECTED_IN_PROMPT = 15

export async function generateArticleIdea({
  apiKey,
  model,
  existingTitles,
  siteName,
  knowledgeBase,
  topic,
  rejectedIdeas = [],
  attempts = 3,
  onUsage,
}: {
  apiKey: string
  model: string
  existingTitles: string[]
  siteName?: string
  /** The site's company background and premise — read before proposing anything. */
  knowledgeBase?: string
  /**
   * What the reader asked for, in their own words — "why a portfolio beats a
   * local web designer". A direction, not a suggestion: with one of these the
   * model works the subject it was handed rather than picking its own. The
   * back catalogue still goes into the prompt, so the angle it lands on is one
   * the site has not already published.
   */
  topic?: string
  /**
   * Ideas already offered for this article and turned down.
   *
   * Without these, regenerating sends exactly the same prompt as the first
   * time: same catalogue, same knowledge base, same instructions. A model has
   * no memory of what it just said, so it lands on the same most-obvious topic
   * — and so does the next model you switch to, which is why changing models
   * looked like it only reworded the idea.
   */
  rejectedIdeas?: RejectedIdea[]
  attempts?: number
  onUsage?: UsageSink
}): Promise<ArticleIdea> {
  const recent = rejectedIdeas.slice(-MAX_REJECTED_IN_PROMPT)
  // A turned-down title is as unavailable as a published one, so a suggestion
  // that lands on it counts as a collision and spends a retry.
  const taken = new Set(
    [...existingTitles, ...recent.map((r) => r.title)].map(normalizeTitle)
  )
  const kb = knowledgeBase?.trim() || ''

  /**
   * A site with a back catalogue is asked for something that catalogue does not
   * cover. A brand new one has nothing to differ from, so asking it to "cover
   * ground none of the above covers" points at an empty list and gives the
   * model nothing to reason from — the knowledge base is the brief instead.
   */
  // Spelled out at this length on purpose. "Do not repeat these" on its own
  // gets read as "say it differently", which is the thing being complained
  // about — the same topic in new words is what a model reaches for first.
  const rejectedBlock = recent.length
    ? `
These ideas were already put to the reader for this article and turned down:
${recent.map((r) => `- ${r.title}${r.keywords?.length ? ` (${r.keywords.join(', ')})` : ''}`).join('\n')}

Do not propose any of them again. Do not reword one, narrow one, widen one, or
approach the same subject from a different angle — the subject itself was
rejected, not the wording. Choose a different subject.
`
    : ''

  const asked = topic?.trim() || ''

  function brief(attempt: number): string {
    const retry = attempt > 0
      ? ' Your previous suggestion was too close to an existing or already-rejected article — go in a clearly different direction.'
      : ''

    // A subject was handed over, so there is nothing to choose. The catalogue
    // still goes in, but as the thing to find an unwritten angle within rather
    // than a list of subjects to steer away from: refusing what was asked for
    // because it grazes an old post is not an answer to the request.
    if (asked) {
      const existing = existingTitles.length
        ? `
These articles already exist on this site:
${existingTitles.map((t) => `- ${t}`).join('\n')}

If the request overlaps one of them, take the angle those do not already cover.
Do not propose a rewording of an article in that list.
`
        : ''

      return `The reader has asked for an article about this specifically:
"""
${asked}
"""
${existing}${rejectedBlock}
Propose ONE article that answers that request. Stay on the subject asked for —
it is a direction, not a starting point to improve on. Sharpen it into a real
article: a title someone would click, and a description saying what it argues
and who it is for.${retry}`
    }

    if (existingTitles.length === 0) {
      // With nothing rejected yet there is one right answer to reach for: the
      // subject the company most needs to open with. Once that has been turned
      // down, asking for it again is asking for the same idea back.
      const opening = recent.length
        ? 'Propose a different opening topic from the knowledge base above — a subject none of the rejected ideas touch.'
        : 'Take the opening topic from the knowledge base above: the subject a first-time reader of this company most needs answered, and that this company is best placed to answer.'

      return `Nothing has been published for this site yet, so there is no back catalogue to work around.
${rejectedBlock}
${opening}${retry}`
    }

    return `These articles already exist. Do NOT propose any of these topics again, or a near-duplicate, rewording, or narrower slice of one:
${existingTitles.map((t) => `- ${t}`).join('\n')}
${rejectedBlock}
Propose ONE genuinely new article that covers ground none of the above covers${
      kb ? ", and that belongs on this company's site given the knowledge base above" : ''
    }.${retry}`
  }

  let last: ArticleIdea | null = null
  // Every attempt used to fail silently and end at one generic sentence, which
  // said nothing about whether the model was cut off, empty, or off-format.
  const failures: string[] = []

  for (let i = 0; i < attempts; i++) {
    const { res, modelUsed } = await postChat(apiKey, {
        model,
        messages: [{
          role: 'user',
          content: `${knowledgeBaseBlock(knowledgeBase)}You are planning the content calendar${siteName ? ` for "${siteName}"` : ''}.

${brief(i)}

Return ONLY valid JSON:
{"title": "the article title", "description": "2-3 sentences on what it covers and why it is worth writing", "keywords": ["kw1", "kw2", "kw3"]}`,
        }],
        // Nudged up so retries actually explore instead of repeating themselves.
        temperature: 0.9,
        // 400 was enough for a title and two lines, until a knowledge base gave
        // the model something to say — replies then ran past the cap and came
        // back as JSON cut off mid-string, which reads as "no usable idea".
        max_tokens: 900,
        response_format: { type: 'json_object' },
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err?.error?.message || `Idea generation failed: ${res.status}`)
    }

    const data = await res.json()
    onUsage?.(readUsage(data, modelUsed))

    const choice = data.choices?.[0]
    const content: string = choice?.message?.content || ''
    const parsed = parseIdeaJson(content)
    if (!parsed) {
      failures.push(attemptFailure(i + 1, content, choice?.finish_reason))
      continue
    }

    parsed.keywords = Array.isArray(parsed.keywords) ? parsed.keywords : []
    parsed.description = parsed.description || ''
    last = parsed

    if (!taken.has(normalizeTitle(parsed.title))) return parsed
  }

  // Every attempt collided. Hand back the last one rather than nothing, and let
  // the caller say so — the user can just hit Regenerate.
  if (last) return last

  // Nothing parsed at all. Say what actually came back: "try again" on its own
  // sends you round the same loop with no idea which knob to turn.
  throw new Error(
    `${model} did not return a usable idea in ${attempts} attempts. ${failures.join('; ')}`
  )
}

export async function generateArticle({
  apiKey,
  model,
  title,
  keywords = [],
  focusKeyword,
  instructions,
  knowledgeBase,
  wordCount = 1400,
  onUsage,
}: {
  apiKey: string
  model: string
  title: string
  keywords?: string[]
  focusKeyword?: string
  instructions?: string
  /** The site's company background and premise — read before writing anything. */
  knowledgeBase?: string
  wordCount?: number
  onUsage?: UsageSink
}): Promise<{
  content: string
  wordCount: number
  excerpt: string
  metaDescription: string
  /** Non-null when the model put a meta description in the body and we lifted it out */
  extractedMetaDescription: string | null
  /** The Yoast fields written in the same call, when the model returned them. */
  seo: SEOMeta | null
}> {
  const systemPrompt = `You are an expert SEO content writer who creates high-quality, comprehensive blog posts.
Your articles are well-structured with proper HTML, engaging, and optimized for search engines while remaining genuinely helpful for readers.
Always output clean HTML without any markdown code blocks or document tags — just the article body HTML.`

  const userPrompt = buildArticlePrompt({ title, keywords, focusKeyword, instructions, knowledgeBase, wordCount })

  const { res: response, modelUsed } = await postChat(
    apiKey,
    {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 4096,
      temperature: 0.7,
    },
    { 'X-Title': 'Zaoflo - AI WordPress Publisher' }
  )

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
  onUsage?.(readUsage(data, modelUsed))
  const rawContent: string = data.choices?.[0]?.message?.content || ''

  // The SEO fields ride along at the end of the same reply. Taken off first,
  // so nothing below counts JSON as part of the article.
  const { body: articleOnly, seo } = splitSeoBlock(rawContent)

  // Keep the meta description out of the body — it belongs in the Yoast field.
  // Doing this before the word/excerpt maths also keeps those counts honest.
  const { content, metaDescription: extracted } = extractMetaDescription(articleOnly)

  const plainText = htmlToText(content)
  const excerpt = plainText.slice(0, 300) + (plainText.length > 300 ? '...' : '')
  const metaDescription =
    extracted || plainText.slice(0, 155) + (plainText.length > 155 ? '...' : '')
  const wc = plainText.split(/\s+/).filter(Boolean).length

  return { content, wordCount: wc, excerpt, metaDescription, extractedMetaDescription: extracted, seo }
}

function buildArticlePrompt({
  title,
  keywords,
  focusKeyword,
  instructions,
  knowledgeBase,
  wordCount,
}: {
  title: string
  keywords: string[]
  focusKeyword?: string
  instructions?: string
  knowledgeBase?: string
  wordCount: number
}): string {
  // The knowledge base goes first: the model should know whose company this is
  // and what the writing is about before it reads a single requirement.
  let prompt = knowledgeBaseBlock(knowledgeBase)
  prompt += `Write a comprehensive, SEO-optimized blog post for the following WordPress post title:\n\n"${title}"\n\n`

  if (focusKeyword) {
    prompt += `Focus keyword: ${focusKeyword}\n`
  }
  if (keywords.length > 0) {
    prompt += `Secondary keywords to naturally include: ${keywords.join(', ')}\n`
  }

  const authorInstructions = instructions?.trim() || ''
  const hasAuthorInstructions = authorInstructions.length > 0

  prompt += `
Hard rules (never break these):
- NEVER exceed ${MAX_ARTICLE_WORDS.toLocaleString('en-US')} words total. If anything below asks for more, write ${MAX_ARTICLE_WORDS.toLocaleString('en-US')} words and make sure the article still reaches a complete conclusion
- The WordPress post title is used as the page <h1>, so DO NOT include any <h1> tag in your output — start the body with an <h2>
- Use proper HTML tags: <h2>, <h3> for headings; <p> for paragraphs; <ul>/<ol>/<li> for lists; <strong>/<em> for emphasis
- Focus keyword must appear in the intro paragraph AND in the text of the first <h2>
- Write naturally — avoid keyword stuffing
- Use transition words and vary sentence length for readability
- The article body itself carries no meta description, SEO summary, excerpt, or labelled front-matter such as "Meta Description:" — anything like that inside the HTML ends up published inside the post. The SEO fields go in the JSON block described at the end, and nowhere else

Defaults${hasAuthorInstructions ? " — follow these ONLY where the author's instructions below do not say otherwise" : ''}:
- Target length: 1,500–1,800 words total (the wordCount hint is ${wordCount})
- Structure:
  1. Intro section (150–200 words): hook the reader, state the problem, and explain what they will learn — written as <p> tags, no heading
  2. 3–5 main <h2> sections (300–400 words each), with 1–2 <h3> subsections per <h2> where they fit naturally
  3. A final <h2> "Conclusion" or call-to-action section (150–200 words)
- Include bulleted or numbered lists where they add clarity — at least one list in the article
- Do NOT use <h4> or deeper heading tags
${hasAuthorInstructions ? `
AUTHOR'S INSTRUCTIONS — these take priority over the defaults above, but never over the hard rules.
Where they specify a word count, heading structure, tone, or format, follow them exactly
and ignore the conflicting default. If they ask for a single <h1>, that requirement is
already satisfied by the WordPress post title — still do not emit an <h1> tag yourself.

${authorInstructions}
` : ''}
Output the HTML body content, starting with the first <p> of the intro. Do not include <html>, <head>, <body>, <h1>, any code block wrappers, or a "Meta Description:" line.

Then, after the article and on its own line, write exactly:
${SEO_MARKER}
followed by a single JSON object with EXACTLY these five keys and no other text:

${SEO_FIELD_RULES}

The JSON is required. An article without it is incomplete. Write it from the article you just wrote, not from the title alone.
Example of the closing block:
${SEO_MARKER}
{"focusKeyphrase":"copyright protection","keyphraseSynonyms":"copyright ownership","yoastTitle":"How Copyright Protection Works for Creatives","yoastMetaDescription":"Learn how copyright protection works for creative work, what it covers automatically, and the steps worth taking to prove ownership of what you make.","slug":"copyright-protection-creative-work"}`

  return prompt
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

/**
 * The SEO block off the end of a combined reply, and the article without it.
 *
 * Written in the same call as the article so one generation is one charge —
 * asking a second time cost a second request for five short strings the model
 * that wrote the article already knew.
 */
function splitSeoBlock(raw: string): { body: string; seo: SEOMeta | null } {
  const at = raw.lastIndexOf(SEO_MARKER)
  if (at === -1) return { body: raw, seo: null }

  const body = raw.slice(0, at)
  const tail = raw.slice(at + SEO_MARKER.length)

  // Models wrap it in a fence about as often as not.
  const cleaned = tail.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) return { body, seo: null }

  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Partial<SEOMeta>
    return {
      body,
      seo: {
        focusKeyphrase: (parsed.focusKeyphrase || '').trim(),
        keyphraseSynonyms: (parsed.keyphraseSynonyms || '').trim(),
        yoastTitle: (parsed.yoastTitle || '').trim(),
        yoastMetaDescription: (parsed.yoastMetaDescription || '').trim(),
        slug: (parsed.slug || '').trim(),
      },
    }
  } catch {
    return { body, seo: null }
  }
}

/** What separates the article from the SEO block in one combined reply. */
const SEO_MARKER = '---SEO-JSON---'

/**
 * The wording of the five fields, shared by both paths so a meta description
 * written alongside the article is held to the same rules as one written on
 * its own.
 */
const SEO_FIELD_RULES = `- focusKeyphrase: 2-4 word phrase someone would Google to find this article. Based on SEARCH INTENT. NOT stop words (do/the/how/you/is/your). Example: "copyright protection" or "email marketing tips"
- keyphraseSynonyms: A DIFFERENT 2-4 word phrase covering the same topic. Example: "copyright ownership" or "intellectual property rights". NOT random words or stop words.
- yoastTitle: SEO title between 50-60 characters (count carefully including spaces)
- yoastMetaDescription: REQUIRED. Between 140 and 155 characters, counted including spaces. One or two complete sentences describing what the reader gets, containing the focus keyphrase, ending in a full stop. Never leave this empty, never write a placeholder.
- slug: URL slug — lowercase hyphenated, max 60 chars. CRITICAL: every word must be fully spelled out, no mid-word cuts. Remove stop words (the/a/is/how/your/do) to stay under 60. Example bad: "copyright-protectio" (cut off). Example good: "copyright-protection-creative-work"`

export interface SEOMeta {
  focusKeyphrase: string
  keyphraseSynonyms: string
  yoastTitle: string
  yoastMetaDescription: string
  slug: string
}

/**
 * Trim to a length without cutting a word in half, preferring to end on a
 * sentence when one finishes close enough to the limit.
 */
function trimToLength(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean

  const window = clean.slice(0, max + 1)
  const sentenceEnd = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '))
  if (sentenceEnd > max * 0.6) return window.slice(0, sentenceEnd + 1).trim()

  const wordEnd = window.lastIndexOf(' ')
  return (wordEnd > 0 ? window.slice(0, wordEnd) : clean.slice(0, max)).trim()
}

/** A description short enough to be a placeholder is treated as missing. */
const MIN_META_DESCRIPTION = 80
const MAX_META_DESCRIPTION = 160

/** Whether what the model returned can stand on its own without a second call. */
export function isSeoComplete(seo: SEOMeta | null): seo is SEOMeta {
  if (!seo) return false
  return Boolean(
    seo.focusKeyphrase &&
    seo.keyphraseSynonyms &&
    seo.yoastTitle &&
    seo.slug &&
    seo.yoastMetaDescription.length >= MIN_META_DESCRIPTION
  )
}

/**
 * The five fields as they will actually be saved: whatever the model gave,
 * held to the lengths Yoast wants, with anything missing derived from the
 * article rather than left blank.
 *
 * The meta description is the field models drop most often, and an empty one
 * is the difference between a search result that reads and one Google writes
 * itself — so it is filled from the article's own opening when it has to be,
 * never from the title alone.
 */
export function finaliseSeoMeta(
  candidate: Partial<SEOMeta> | null,
  { title, keywords, articleText, liftedDescription }: {
    title: string
    keywords: string[]
    articleText: string
    liftedDescription?: string | null
  }
): SEOMeta {
  const titleWords = title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean)
  const c = candidate || {}

  const focusKeyphrase = (c.focusKeyphrase || '').trim()
    || keywords[0]
    || titleWords.slice(0, 3).join(' ')

  const description = (c.yoastMetaDescription || '').trim()
  const usable = description.length >= MIN_META_DESCRIPTION
    ? description
    : (liftedDescription && liftedDescription.trim().length >= MIN_META_DESCRIPTION
        ? liftedDescription.trim()
        : articleText.trim() || title)

  return {
    focusKeyphrase,
    keyphraseSynonyms: (c.keyphraseSynonyms || '').trim()
      || keywords[1]
      || titleWords.slice(-3).join(' '),
    yoastTitle: trimToLength((c.yoastTitle || '').trim() || title, 60),
    yoastMetaDescription: trimToLength(usable, MAX_META_DESCRIPTION),
    slug: safeSlug((c.slug || '').trim() || title),
  }
}

export async function generateSEOMeta(
  apiKey: string,
  model: string,
  title: string,
  content: string,
  keywords: string[],
  onUsage?: UsageSink
): Promise<SEOMeta> {
  const plainContent = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

  const prompt = `You are an SEO expert. Return ONLY a valid JSON object with EXACTLY these 5 keys for the article below.

RULES:
${SEO_FIELD_RULES}

Article title: ${title}
Keywords: ${keywords.join(', ')}
Content: ${plainContent.slice(0, 800)}

Return ONLY the JSON, no markdown, no explanation. Example format:
{"focusKeyphrase":"copyright protection","keyphraseSynonyms":"copyright ownership","yoastTitle":"How Copyright Protection Works for Creatives","yoastMetaDescription":"Learn how copyright protection works...","slug":"copyright-protection-creative-work"}`

  const { res: response, modelUsed } = await postChat(
    apiKey,
    {
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400,
    },
    { 'X-Title': 'Zaoflo - AI WordPress Publisher' }
  )

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
  onUsage?.(readUsage(data, modelUsed))
  const raw = data.choices?.[0]?.message?.content || '{}'

  // Strip markdown code fences that some models wrap around JSON
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  try {
    const parsed = JSON.parse(cleaned) as SEOMeta

    parsed.yoastTitle = parsed.yoastTitle || title
    parsed.slug = safeSlug(parsed.slug || title)

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
