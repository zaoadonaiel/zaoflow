export const IMAGE_GEN_MODELS = [
  { id: 'google/gemini-3-pro-image',        name: 'Nano Banana Pro',    badge: 'Best' },
  { id: 'google/gemini-3.1-flash-image',    name: 'Nano Banana 2',      badge: 'Google' },
  { id: 'google/gemini-3.1-flash-lite-image', name: 'Nano Banana 2 Lite', badge: 'Fast' },
  { id: 'google/gemini-2.5-flash-image',    name: 'Nano Banana',        badge: '' },
  { id: 'openai/gpt-5-image',               name: 'GPT-5 Image',        badge: 'OpenAI' },
  { id: 'openai/gpt-5-image-mini',          name: 'GPT-5 Image Mini',   badge: 'Fast' },
  { id: 'openai/gpt-5.4-image-2',           name: 'GPT-5.4 Image 2',    badge: '' },
]

/**
 * The four switches under the prompt. Each one is a sentence the model reads
 * after the prompt itself, so "Realistic" and "People" mean something specific
 * rather than being left to the model's mood.
 *
 * People and Words are deliberately not neutral when off: an image generator
 * left to itself puts strangers and misspelled signage into everything, so
 * unselected states out that they are unwanted.
 */
export type ImageStyleFlag = 'realistic' | 'illustration' | 'people' | 'words'

export type ImageStyleFlags = Record<ImageStyleFlag, boolean>

export const DEFAULT_IMAGE_STYLE: ImageStyleFlags = {
  realistic: true,
  illustration: false,
  people: false,
  words: false,
}

/** Realistic and Illustration describe the same thing two ways — one at most. */
export const IMAGE_STYLE_EXCLUSIVE: ImageStyleFlag[] = ['realistic', 'illustration']

export const IMAGE_STYLE_LABELS: Record<ImageStyleFlag, string> = {
  realistic: 'Realistic',
  illustration: 'Illustration',
  people: 'People',
  words: 'Words',
}

const DIRECTIVES: Record<ImageStyleFlag, { on: string; off?: string }> = {
  realistic: {
    on: 'Photorealistic: an actual photograph, with natural lighting, real depth '
      + 'of field and true-to-life texture and detail. Not an illustration, '
      + 'painting, 3D render or digital artwork.',
  },
  illustration: {
    on: 'Illustrated, in the style of vector artwork made in Adobe Illustrator: '
      + 'clean flat shapes, deliberate limited colour palette, crisp edges and '
      + 'even lighting. Clearly a designed illustration rather than a photograph.',
  },
  people: {
    on: 'Include people in the scene, naturally posed and doing something that '
      + 'belongs to the subject, with anatomically correct hands and faces.',
    off: 'No people at all: no faces, no hands, no bodies, no silhouettes, and '
      + 'no human figures in the background.',
  },
  words: {
    on: 'Where the scene naturally carries text — book pages, signage, documents, '
      + 'screens — render it as real, correctly spelled, legible English words.',
    off: 'No text of any kind anywhere in the image: no words, letters, numbers, '
      + 'signage, labels, captions, watermarks or logos. Any surface that would '
      + 'normally carry writing is blank.',
  },
}

/**
 * The prompt as the generator should receive it: what was typed, followed by
 * whatever the switches add. The typed prompt is never rewritten — it is what
 * the box goes on showing and what a regenerate starts from again.
 */
export function promptWithStyle(prompt: string, flags: ImageStyleFlags): string {
  const parts: string[] = []
  for (const key of Object.keys(DIRECTIVES) as ImageStyleFlag[]) {
    const directive = flags[key] ? DIRECTIVES[key].on : DIRECTIVES[key].off
    if (directive) parts.push(directive)
  }
  const base = prompt.trim().replace(/\.$/, '')
  return parts.length ? `${base}. ${parts.join(' ')}` : base
}

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

const DEFAULT_SIZES: SizeOption[] = [
  { value: '1024x1024', label: 'Square — 1024×1024' },
]

const MODEL_SIZES: Record<string, SizeOption[]> = {
  'openai/gpt-5-image':      GPT_IMAGE_SIZES,
  'openai/gpt-5-image-mini': GPT_IMAGE_SIZES,
  'openai/gpt-5.4-image-2':  GPT_IMAGE_SIZES,
}

export function getSizesForModel(modelId: string): SizeOption[] {
  return MODEL_SIZES[modelId] ?? DEFAULT_SIZES
}

export function getDefaultSize(modelId: string): string {
  return getSizesForModel(modelId)[0].value
}

/**
 * Some image models take pixels ("1536x1024") and some take an aspect ratio
 * ("3:2"), and OpenRouter passes whichever we send straight through — so a
 * model of the second kind answers a perfectly good request with a 422 listing
 * the ratios it will accept.
 *
 * Rather than keeping a table of which model wants which (it would be wrong
 * the week a new one appears), read the ratios out of the refusal and retry
 * with the one closest to the size that was asked for.
 */
function ratiosInError(message: string): string[] {
  return [...message.matchAll(/"(\d{1,2}:\d{1,2})"/g)].map((m) => m[1])
}

/**
 * A model that wants more pixels than were asked for names a size it will
 * accept ("Use a larger size such as \"2048x2048\""). Take it rather than
 * guessing at its minimum.
 */
function suggestedSize(message: string, requested: string): string | null {
  const sizes = [...message.matchAll(/"(\d{3,5}x\d{3,5})"/g)].map((m) => m[1])
  return sizes.find((size) => size !== requested) ?? null
}

/** Some models would rather be left to their own default than given a size. */
function wantsNoSize(message: string): boolean {
  return /omit size/i.test(message)
}

function closestRatio(size: string, options: string[]): string | null {
  const [w, h] = size.split('x').map(Number)
  if (!w || !h || !options.length) return options[0] ?? null

  const target = Math.log(w / h)
  let best = options[0]
  let bestGap = Infinity
  for (const option of options) {
    const [a, b] = option.split(':').map(Number)
    if (!a || !b) continue
    const gap = Math.abs(Math.log(a / b) - target)
    if (gap < bestGap) { best = option; bestGap = gap }
  }
  return best
}

export interface ImageResult {
  url?: string   // HTTP URL — present when OpenRouter returns a URL
  b64?: string   // raw base64 string — present when OpenRouter returns b64_json
  /** The whole response, so the caller can read the usage block off it. */
  raw?: unknown
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
  const post = (extra: Record<string, unknown>) =>
    fetch('https://openrouter.ai/api/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://zaoflo.com',
      },
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        // Don't force response_format — let each model return what it natively supports
        ...extra,
      }),
      signal: AbortSignal.timeout(90000),
    })

  const send = (sizeValue: string) => post({ size: sizeValue })
  const sendWithoutSize = () => post({})

  let response = await send(size)

  // Models disagree about what `size` even is — some want an aspect ratio,
  // some have a minimum number of pixels, some would rather pick for
  // themselves. Each says so in the refusal, so ask again on its terms rather
  // than keeping a table of which model is which.
  if (!response.ok && (response.status === 400 || response.status === 422)) {
    const refusal = await response.clone().json().catch(() => ({}))
    const message: string = refusal?.error?.message || ''

    const ratio = closestRatio(size, ratiosInError(message))
    const larger = suggestedSize(message, size)

    if (ratio) response = await send(ratio)
    else if (larger) response = await send(larger)
    else if (wantsNoSize(message)) response = await sendWithoutSize()
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Invalid OpenRouter API key. Check your key in Settings.')
    }
    if (response.status === 402) {
      throw new Error('Your OpenRouter account has no credits. Add credits at openrouter.ai.')
    }
    const body = await response.json().catch(() => ({}))
    throw new Error(body?.error?.message || `Image generation failed: ${response.status}`)
  }

  const data = await response.json()
  const item = data?.data?.[0]

  if (!item) throw new Error('Image generation returned an empty response')

  if (item.url) return { url: item.url, raw: data }
  if (item.b64_json) return { b64: item.b64_json, raw: data }

  throw new Error('Unexpected image response format — no URL or base64 data found')
}
