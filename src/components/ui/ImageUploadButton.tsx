'use client'

import { useRef, useState } from 'react'
import { Upload, Loader2 } from 'lucide-react'
import type { GeneratedImage } from '@/types'
import toast from 'react-hot-toast'

interface Props {
  /** Tags the upload with a site, so it files itself in the library like the rest. */
  siteId?: string | null
  articleId?: string | null
  /** Called once per file, in the order they were chosen. */
  onUploaded?: (image: GeneratedImage) => void
  /** Called once when the batch is done, for callers that reload a list rather than add to one. */
  onFinished?: (images: GeneratedImage[]) => void
  /** Several at once, for the library. The image panel takes one — it is picking a featured image. */
  multiple?: boolean
  label?: string
  className?: string
}

/**
 * Bringing in an image that was never generated — a photograph, a client's own
 * artwork, something made elsewhere.
 *
 * It goes to the same place a generated image goes, so an uploaded picture is
 * in the library, pickable for any article, and published with the same alt
 * text as anything else. Nothing downstream has to know the difference.
 */
export default function ImageUploadButton({
  siteId, articleId, onUploaded, onFinished, multiple = false, label = 'Upload', className = '',
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)

    const uploaded: GeneratedImage[] = []
    let failed = 0
    // One at a time rather than all at once: a phone photo is several
    // megabytes, and a dozen in parallel is how an upload times out.
    for (const file of Array.from(files)) {
      try {
        const body = new FormData()
        body.append('file', file)
        if (siteId) body.append('site_id', siteId)
        if (articleId) body.append('article_id', articleId)
        body.append('description', file.name)

        const res = await fetch('/api/images/upload', { method: 'POST', body })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Upload failed')
        uploaded.push(data.image as GeneratedImage)
        onUploaded?.(data.image as GeneratedImage)
      } catch (err) {
        failed++
        toast.error(err instanceof Error ? err.message : `Could not upload ${file.name}`)
      }
    }

    const done = files.length - failed
    if (done > 0) toast.success(done === 1 ? 'Image uploaded' : `${done} images uploaded`)
    // Once for the batch, so a caller that reloads a list does it after the
    // last file rather than five times through six uploads.
    if (uploaded.length) onFinished?.(uploaded)

    setBusy(false)
    // Cleared so choosing the same file again still fires a change event.
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple={multiple}
        onChange={(e) => handleFiles(e.target.files)}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        title={multiple ? 'Upload images from this device' : 'Upload an image from this device'}
        className={className || 'flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50'}
      >
        {busy
          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Uploading…</>
          : <><Upload className="w-3.5 h-3.5" />{label}</>}
      </button>
    </>
  )
}
