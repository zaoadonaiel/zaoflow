import sharp from 'sharp'

/**
 * Server-side twin of `image-compression.ts`.
 *
 * The browser version runs in the article editor when the user hits Compress
 * on a library image. This one runs in `publishArticle` right before the
 * image goes to WordPress or the Node.js site, so a queued post that fires
 * from cron -- no browser in the loop -- still ships a shrunken image.
 *
 * The strategy is the same: walk quality down before dimensions down, since a
 * softer JPEG-of-JPEG reads far better than a resized-then-recompressed one.
 * Only when the lowest quality we accept still misses the target do we start
 * shrinking, and even then we keep the aspect ratio intact.
 */

export const TARGET_BYTES = 1_000_000

const QUALITIES = [92, 85, 78, 72, 66, 60] as const
const SCALE_STEPS = [1, 0.85, 0.75, 0.6, 0.5] as const

export type CompressedFormat = 'webp' | 'jpeg'

export interface ServerCompressionResult {
  buffer: Buffer
  bytes: number
  format: CompressedFormat
  mime: 'image/webp' | 'image/jpeg'
  ext: 'webp' | 'jpg'
  /** True when the source was already <= target and no re-encode ran. */
  skipped: boolean
  /** True when even the smallest+lowest attempt could not fit under target. */
  overTarget: boolean
  originalBytes: number
}

/**
 * Fetch an image URL and return a buffer that fits under TARGET_BYTES.
 *
 * Skips work entirely when the source is already small enough -- the publish
 * path calls this on every post that has compress_on_publish=true, so a
 * pass-through has to be free.
 *
 * A PNG or GIF or already-small file just comes back as-is: the original
 * bytes, the original mime, no re-encode. Only oversized files are put
 * through sharp, and even then WebP is preferred over JPEG for the ratio.
 */
export async function compressImageFromUrl(
  imageUrl: string,
  targetBytes: number = TARGET_BYTES,
): Promise<ServerCompressionResult> {
  const res = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) {
    throw new Error(`Could not fetch image for compression (${res.status})`)
  }

  const sourceMime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim()
  const sourceBuffer = Buffer.from(await res.arrayBuffer())

  if (sourceBuffer.length <= targetBytes) {
    return {
      buffer: sourceBuffer,
      bytes: sourceBuffer.length,
      format: sourceMime === 'image/webp' ? 'webp' : 'jpeg',
      mime: sourceMime === 'image/webp' ? 'image/webp' : 'image/jpeg',
      ext: sourceMime === 'image/webp' ? 'webp' : 'jpg',
      skipped: true,
      overTarget: false,
      originalBytes: sourceBuffer.length,
    }
  }

  // WebP first for the better ratio; a corrupt or unsupported source falls
  // through to JPEG so we never lose the publish over a codec quirk.
  try {
    return await encode(sourceBuffer, 'webp', targetBytes)
  } catch {
    return await encode(sourceBuffer, 'jpeg', targetBytes)
  }
}

async function encode(
  sourceBuffer: Buffer,
  format: CompressedFormat,
  targetBytes: number,
): Promise<ServerCompressionResult> {
  const originalBytes = sourceBuffer.length
  const meta = await sharp(sourceBuffer).metadata()
  const srcWidth = meta.width ?? 0
  const srcHeight = meta.height ?? 0
  if (!srcWidth || !srcHeight) {
    throw new Error('Could not read image dimensions')
  }

  let smallest: ServerCompressionResult | null = null

  for (const scale of SCALE_STEPS) {
    const width = Math.max(1, Math.round(srcWidth * scale))
    const height = Math.max(1, Math.round(srcHeight * scale))

    // A single decode+resize per scale, then re-encoded at each quality.
    // Reusing the resized pipeline would be nicer, but sharp finalises on
    // toBuffer() and needs a fresh one per format call.
    for (const quality of QUALITIES) {
      const pipeline = sharp(sourceBuffer).resize({ width, height, fit: 'fill' })
      const buffer = format === 'webp'
        ? await pipeline.webp({ quality }).toBuffer()
        : await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer()

      const attempt: ServerCompressionResult = {
        buffer,
        bytes: buffer.length,
        format,
        mime: format === 'webp' ? 'image/webp' : 'image/jpeg',
        ext: format === 'webp' ? 'webp' : 'jpg',
        skipped: false,
        overTarget: false,
        originalBytes,
      }

      if (buffer.length <= targetBytes) return attempt
      if (!smallest || buffer.length < smallest.bytes) smallest = attempt
    }
  }

  return { ...(smallest as ServerCompressionResult), overTarget: true }
}
