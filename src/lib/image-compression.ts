'use client'

/**
 * Best-quality compression that hits a size target — WebP first, JPEG as a
 * fallback for the handful of engines that still refuse it.
 *
 * The strategy walks *quality* down before *dimensions* down, because a mildly
 * softer JPEG-of-JPEG reads far better than a resized-then-recompressed one:
 * the visible artifact of over-scaling is jagged edges the eye latches onto,
 * where a slightly lower quantiser is just less crisp fill. Only when the
 * lowest quality we accept still misses the target do we start shrinking, and
 * even then we keep the aspect ratio intact.
 */

/** 1 MB in decimal bytes, matching how file sizes are usually spoken about. */
export const TARGET_BYTES = 1_000_000

/** The quality ladder for each pass, high to low. */
const QUALITIES = [0.92, 0.85, 0.78, 0.72, 0.66, 0.6]

/**
 * Widths to try, as fractions of the source. 1 first, so a compressible image
 * never gets resized. The floor of 0.5 keeps a hero image from becoming a
 * thumbnail — anything smaller than that would look downgraded on the page.
 */
const SCALE_STEPS = [1, 0.85, 0.75, 0.6, 0.5]

export type CompressedFormat = 'webp' | 'jpeg'

export interface CompressionResult {
  blob: Blob
  bytes: number
  format: CompressedFormat
  quality: number
  /** True when a dimension step below 100% was needed to hit the target. */
  resized: boolean
  /** The chosen encoded dimensions. */
  width: number
  height: number
  originalBytes: number
  /** True when even the smallest+lowest attempt could not fit under target. */
  overTarget: boolean
}

/**
 * Compress an image URL down to ≤ TARGET_BYTES.
 *
 * Fetches the file, decodes it in the browser, then walks the ladder above
 * (quality ↓ before size ↓) and returns the first output that fits. If nothing
 * fits, returns the smallest attempt with `overTarget=true` so callers can
 * warn the user rather than silently ship a larger file.
 */
export async function compressImage(sourceUrl: string): Promise<CompressionResult> {
  const res = await fetch(sourceUrl)
  if (!res.ok) throw new Error(`Could not fetch the image (${res.status})`)
  const source = await res.blob()

  // createImageBitmap decodes off the main thread on modern browsers, and it
  // reads more file types than <img> in a single line of code.
  const bitmap = await createImageBitmap(source)
  try {
    // Try WebP first for the better ratio; fall through to JPEG if either the
    // browser refuses it or the produced blob is not actually WebP (older
    // Safari silently returns a PNG when asked for webp).
    return await encode(bitmap, 'webp', source.size)
  } catch {
    return await encode(bitmap, 'jpeg', source.size)
  } finally {
    bitmap.close?.()
  }
}

async function encode(
  bitmap: ImageBitmap,
  format: CompressedFormat,
  originalBytes: number,
): Promise<CompressionResult> {
  const mime = format === 'webp' ? 'image/webp' : 'image/jpeg'

  let smallest: CompressionResult | null = null

  for (const scale of SCALE_STEPS) {
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { alpha: format === 'webp' })
    if (!ctx) throw new Error('Canvas 2D context not available in this browser')
    ctx.drawImage(bitmap, 0, 0, width, height)

    for (const quality of QUALITIES) {
      const blob = await canvasToBlob(canvas, mime, quality)
      if (!blob) throw new Error(`This browser did not return a ${format} blob`)
      // Safari 13 and earlier hand back a PNG when asked for WebP — flag the
      // format mismatch so the caller retries with JPEG.
      if (!blob.type.startsWith(mime)) {
        throw new Error(`This browser rendered ${blob.type} when asked for ${mime}`)
      }

      const attempt: CompressionResult = {
        blob,
        bytes: blob.size,
        format,
        quality,
        resized: scale < 1,
        width,
        height,
        originalBytes,
        overTarget: false,
      }

      if (blob.size <= TARGET_BYTES) return attempt

      // Hold onto the smallest attempt so far in case nothing fits — the user
      // still gets *some* reduction, even if we could not reach the goal.
      if (!smallest || blob.size < smallest.bytes) smallest = attempt
    }
  }

  return { ...(smallest as CompressionResult), overTarget: true }
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality))
}
