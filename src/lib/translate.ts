/**
 * Article translation via OpenRouter (Anthropic model by default).
 *
 * Used by the static-site publish path when "Publish in both languages"
 * is on: the primary-language article is translated to the other
 * language before both entries are committed to the target repo.
 *
 * The prompt asks for a JSON object with the same shape as
 * `StaticArticleEntry` fields, so the caller can drop the result
 * straight into the second language bucket.
 */

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'

// Two-letter codes match the language buckets in articles.json.
export type LanguageCode = 'en' | 'es'

const LANGUAGE_LABEL: Record<LanguageCode, string> = {
  en: 'English',
  es: 'Spanish',
}

export interface TranslatableArticle {
  title: string
  excerpt: string
  body: string
}

export interface TranslatedArticle {
  title: string
  excerpt: string
  slug: string
  body: string
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80)
}

export async function translateArticle({
  apiKey,
  model,
  from,
  to,
  article,
}: {
  apiKey: string
  model: string
  from: LanguageCode
  to: LanguageCode
  article: TranslatableArticle
}): Promise<TranslatedArticle> {
  const fromLabel = LANGUAGE_LABEL[from]
  const toLabel = LANGUAGE_LABEL[to]

  const prompt = `Translate this article from ${fromLabel} to ${toLabel}. Return ONLY valid JSON with these fields: title, excerpt, slug, body.

Rules:
- title, excerpt, body: natural, idiomatic ${toLabel}. Keep all HTML tags in body intact and untranslated.
- slug: URL-friendly ${toLabel} version (lowercase, words separated by hyphens, no accents or special characters).
- Do not add commentary; return only the JSON object.

Article to translate:
{
  "title": ${JSON.stringify(article.title)},
  "excerpt": ${JSON.stringify(article.excerpt)},
  "body": ${JSON.stringify(article.body)}
}`

  const res = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://zaoflo.com',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(120_000),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Translation failed (${res.status}): ${err.slice(0, 200)}`)
  }

  const data = await res.json()
  const raw = data.choices?.[0]?.message?.content || '{}'

  let parsed: Partial<TranslatedArticle>
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Translation returned invalid JSON')
  }

  if (!parsed.title || !parsed.body) {
    throw new Error('Translation missing title or body')
  }

  // Slug is nice-to-have from the model; derive from title when absent
  // or when the model returned something that would break URLs.
  const safeSlug = parsed.slug && /^[a-z0-9-]+$/.test(parsed.slug)
    ? parsed.slug
    : slugify(parsed.title)

  return {
    title: parsed.title,
    excerpt: parsed.excerpt || '',
    slug: safeSlug || slugify(parsed.title),
    body: parsed.body,
  }
}
