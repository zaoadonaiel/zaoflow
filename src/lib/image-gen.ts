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
// Krea/Gemini/Qwen that accept an arbitrary width×height.
const DEFAULT_SIZES: SizeOption[] = [
  { value: '1024x1024', label: 'Square — 1024×1024' },
  { value: '1920x1080', label: 'Widescreen — 1920×1080 (HD)' },
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
      prompt,
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
    throw new Error(body?.error?.message || `Image generation failed: ${response.status}`)
  }

  const data = await response.json()
  const item = data?.data?.[0]

  if (!item) throw new Error('Image generation returned an empty response')

  const usage = readImageUsage(data, model, 1)
  if (item.url) return { url: item.url, usage }
  if (item.b64_json) return { b64: item.b64_json, usage }

  throw new Error('Unexpected image response format — no URL or base64 data found')
}
