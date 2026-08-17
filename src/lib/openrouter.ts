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

export async function generateArticle({
  apiKey,
  model,
  title,
  keywords = [],
  focusKeyword,
  instructions,
  wordCount = 1400,
}: {
  apiKey: string
  model: string
  title: string
  keywords?: string[]
  focusKeyword?: string
  instructions?: string
  wordCount?: number
}): Promise<{
  content: string
  wordCount: number
  excerpt: string
  metaDescription: string
  /** Non-null when the model put a meta description in the body and we lifted it out */
  extractedMetaDescription: string | null
}> {
  const systemPrompt = `You are an expert SEO content writer who creates high-quality, comprehensive blog posts.
Your articles are well-structured with proper HTML, engaging, and optimized for search engines while remaining genuinely helpful for readers.
Always output clean HTML without any markdown code blocks or document tags — just the article body HTML.`

  const userPrompt = buildArticlePrompt({ title, keywords, focusKeyword, instructions, wordCount })

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
  const rawContent: string = data.choices?.[0]?.message?.content || ''

  // Keep the meta description out of the body — it belongs in the Yoast field.
  // Doing this before the word/excerpt maths also keeps those counts honest.
  const { content, metaDescription: extracted } = extractMetaDescription(rawContent)

  const plainText = htmlToText(content)
  const excerpt = plainText.slice(0, 300) + (plainText.length > 300 ? '...' : '')
  const metaDescription =
    extracted || plainText.slice(0, 155) + (plainText.length > 155 ? '...' : '')
  const wc = plainText.split(/\s+/).filter(Boolean).length

  return { content, wordCount: wc, excerpt, metaDescription, extractedMetaDescription: extracted }
}

function buildArticlePrompt({
  title,
  keywords,
  focusKeyword,
  instructions,
  wordCount,
}: {
  title: string
  keywords: string[]
  focusKeyword?: string
  instructions?: string
  wordCount: number
}): string {
  let prompt = `Write a comprehensive, SEO-optimized blog post for the following WordPress post title:\n\n"${title}"\n\n`

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
- Output the article body ONLY. Do NOT write a meta description, SEO summary, excerpt, or any labelled front-matter such as "Meta Description:" — those fields are generated separately and anything like that here ends up published inside the post

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
Output ONLY the HTML body content, starting with the first <p> of the intro. Do not include <html>, <head>, <body>, <h1>, any code block wrappers, or a "Meta Description:" line.`

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

export interface SEOMeta {
  focusKeyphrase: string
  keyphraseSynonyms: string
  yoastTitle: string
  yoastMetaDescription: string
  slug: string
}

export async function generateSEOMeta(
  apiKey: string,
  model: string,
  title: string,
  content: string,
  keywords: string[]
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
