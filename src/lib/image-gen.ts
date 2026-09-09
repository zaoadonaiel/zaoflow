export const IMAGE_GEN_MODELS = [
  { id: 'openai/gpt-image-1',            name: 'GPT Image 1',        badge: 'Best' },
  { id: 'openai/gpt-image-1-mini',        name: 'GPT Image 1 Mini',   badge: 'Fast' },
  { id: 'openai/gpt-image-2',            name: 'GPT Image 2',        badge: '' },
  { id: 'google/gemini-3.1-flash-image',  name: 'Gemini Flash Image', badge: 'Google' },
  { id: 'krea/krea-2-large',             name: 'Krea 2 Large',       badge: 'HD' },
  { id: 'krea/krea-2-medium',            name: 'Krea 2 Medium',      badge: '' },
  { id: 'krea/krea-2-medium-turbo',      name: 'Krea 2 Turbo',       badge: 'Fast' },
  { id: 'qwen/qwen-image-3',             name: 'Qwen Image 3',       badge: '' },
]

export interface SizeOption {
  value: string
  label: string
}

const GPT_IMAGE_SIZES: SizeOption[] = [
  { value: '1024x1024', label: 'Square — 1024×1024' },
  { value: '1536x1024', label: 'Landscape — 1536×1024' },
  { value: '1024x1536', label: 'Portrait — 1024×1536' },
  { value: 'auto',      label: 'Auto' },
]

// 1920×1080 is not on the OpenAI native list — routed here for models like
// Krea/Gemini/Qwen that accept an arbitrary width×height. Listed first so
// getDefaultSize picks it — HD widescreen is what the writer wants on the
// featured-image slot.
const DEFAULT_SIZES: SizeOption[] = [
  { value: '1920x1080', label: 'Widescreen — 1920×1080 (HD)' },
  { value: '1024x1024', label: 'Square — 1024×1024' },
]

const MODEL_SIZES: Record<string, SizeOption[]> = {
  'openai/gpt-image-1':      GPT_IMAGE_SIZES,
  'openai/gpt-image-1-mini': GPT_IMAGE_SIZES,
  'openai/gpt-image-2':      GPT_IMAGE_SIZES,
}

export function getSizesForModel(modelId: string): SizeOption[] {
  return MODEL_SIZES[modelId] ?? DEFAULT_SIZES
}

export function getDefaultSize(modelId: string): string {
  return getSizesForModel(modelId)[0].value
}

import { readImageUsage, type UsageInfo } from '@/lib/ai-cost'

export interface ImageResult {
  url?: string   // HTTP URL — present when OpenRouter returns a URL
  b64?: string   // raw base64 string — present when OpenRouter returns b64_json
  usage: UsageInfo
}

// The default look for every image the app generates. Kept as a single string
// and applied at the API boundary so future callers get it for free — no need
// to remember to layer this into their own prompt builder.
const NATURAL_PHOTO_STYLE =
  'Style: natural photography — shot on a real camera with a real lens, ' +
  'natural lighting, realistic skin tones with visible texture and subtle imperfections, ' +
  'soft and true-to-life colors, subtle color grading, candid documentary feel, ' +
  'minimal post-processing, authentic and unretouched. ' +
  'Avoid: oversaturated colors, HDR-style over-processing, plastic or airbrushed skin, ' +
  'glossy or waxy finish, hyper-stylized rendering, artificial AI-looking aesthetic, ' +
  'overly sharpened details, neon or crushed contrast.'

// If any of these show up in the prompt the caller has already asked for a
// non-photographic look — a drawing, cartoon, 3D render, etc. Layering the
// photo-style guidance on top would fight the user's intent, so opt out.
const NON_PHOTO_MARKERS = /\b(illustrat(?:ion|ed)|drawing|cartoon|painting|sketch|digital art|render(?:ing|ed)?|3d|cgi|anime|vector|pixel art)\b/i

// A marker unique to our natural-style block, so a prompt that has already been
// augmented (e.g. the "Edit this image" flow that reuses the previous prompt)
// does not get the block appended twice.
const NATURAL_STYLE_MARKER = 'Style: natural photography'

/**
 * Layer the app's default photography aesthetic onto a raw prompt.
 *
 * Idempotent: a second call on the same string is a no-op, so it is safe for
 * the "Edit this image" flow that re-feeds the previous prompt through the
 * pipeline. Skips prompts that explicitly ask for a non-photographic look
 * (illustration, cartoon, 3D render, etc.) so the styling does not contradict
 * the caller's intent.
 */
export function applyNaturalPhotoStyle(prompt: string): string {
  const trimmed = prompt.trim()
  if (!trimmed) return trimmed
  if (trimmed.includes(NATURAL_STYLE_MARKER)) return trimmed
  if (NON_PHOTO_MARKERS.test(trimmed)) return trimmed
  return `${trimmed}. ${NATURAL_PHOTO_STYLE}`
}

export async function generateImage({
  apiKey,
  prompt,
  model,
  size,
}: {
  apiKey: string
  prompt: string
  model: string
  size: string
}): Promise<ImageResult> {
  const response = await fetch('https://openrouter.ai/api/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://zaoflo.com',
    },
    body: JSON.stringify({
      model,
      // Natural-photo styling is applied here so every code path — article
      // editor, standalone generator, SEO builder, any future caller — gets
      // the same realistic look without having to opt in.
      prompt: applyNaturalPhotoStyle(prompt),
      size,
      n: 1,
      // Don't force response_format — let each model return what it natively supports
    }),
    signal: AbortSignal.timeout(90000),
  })

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Invalid OpenRouter API key. Check your key in Settings.')
    }
    if (response.status === 402) {
      throw new Error('Your OpenRouter account has no credits. Add credits at openrouter.ai.')
    }
    const body = await response.json().catch(() => ({}))
    const raw: string = body?.error?.message || `Image generation failed: ${response.status}`

    // Google Gemini answers "Request contains an invalid argument" verbatim
    // when its safety filter refuses the prompt — no useful detail. Most
    // common trigger from this app: race/ethnicity or gender-negation
    // wording in the filter block. Nudge the user toward a workaround
    // instead of surfacing the opaque upstream string.
    if (/invalid argument/i.test(raw)) {
      throw new Error(
        `The image provider refused the request ("${raw}"). ` +
        `Usually the safety filter on Google Gemini — try switching to ` +
        `openai/gpt-image-1, turning off the Nationality or Gender filter, ` +
        `or picking a preset size instead of a custom width×height.`,
      )
    }
    throw new Error(raw)
  }

  const data = await response.json()
  const item = data?.data?.[0]

  if (!item) throw new Error('Image generation returned an empty response')

  const usage = readImageUsage(data, model, 1)
  if (item.url) return { url: item.url, usage }
  if (item.b64_json) return { b64: item.b64_json, usage }

  throw new Error('Unexpected image response format — no URL or base64 data found')
}
