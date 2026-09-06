'use client'

import { useState } from 'react'
import { Globe, Loader2, Send, Minimize2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { compressImage, TARGET_BYTES } from '@/lib/image-compression'
import { fileSize } from '@/lib/format'
import type { Site } from '@/types'
import toast from 'react-hot-toast'

interface Props {
  open: boolean
  onClose: () => void
  /** The library URL of the image being sent. */
  imageUrl: string
  /**
   * The generated_images row id. Required to compress before send, since
   * compression writes the smaller file back to the library. If absent, the
   * compress toggle is disabled with a tooltip.
   */
  imageId?: string | null
  /** Current file size in bytes, when known — drives the compression hint. */
  imageBytes?: number | null
  /** What the image is of — becomes the WP alt when the user has not typed one. */
  fallbackAlt?: string | null
  /** Every site this user has — the picker filters to WordPress ones itself. */
  sites: Site[]
  /** A site to pre-select, when the caller already knows which one they mean. */
  defaultSiteId?: string | null
  /**
   * Optional hook after a successful push, so callers can close/refresh. Called
   * with `compressed: true` when the send included a compression pass, so the
   * caller can also refresh the library row that just got smaller.
   */
  onSent?: (result: {
    siteId: string
    siteName: string
    mediaId: number
    compressed: boolean
    /** The URL actually pushed — may differ from the input when compressed. */
    sentUrl: string
  }) => void
}

/**
 * A small dialog for pushing a library image into a WordPress site's media
 * library. One picker, one Send, one call — with an optional "compress first"
 * pass that shrinks the image below 1 MB before it goes to WordPress and
 * updates the library row in the same step.
 */
export default function SendToWordPressModal({
  open, onClose, imageUrl, imageId, imageBytes, fallbackAlt, sites, defaultSiteId, onSent,
}: Props) {
  // Only WordPress sites can receive a push — a nodejs site has no /wp-json
  // media endpoint, and listing it here would be a decision we then had to
  // reject at click time.
  const wpSites = sites.filter((s) => !s.site_type || s.site_type === 'wordpress')
  const [siteId, setSiteId] = useState<string>(
    defaultSiteId && wpSites.some((s) => s.id === defaultSiteId)
      ? defaultSiteId
      : wpSites[0]?.id || '',
  )
  const [alt, setAlt] = useState<string>('')
  const [sending, setSending] = useState(false)
  // Compress default: on when the file is known to be over 1 MB; off when it's
  // already small or when we can't check. Never forced — the user sees the
  // switch and the current size and decides.
  const overTarget = (imageBytes ?? 0) > TARGET_BYTES
  const canCompress = !!imageId
  const [compress, setCompress] = useState(canCompress && overTarget)

  async function send() {
    if (!siteId) { toast.error('Pick a site to send to'); return }
    setSending(true)

    let urlToSend = imageUrl
    let compressed = false
    let compressedBytes: number | null = null

    try {
      if (compress && canCompress && imageId) {
        // Client-side compress → upload to the library's compress endpoint,
        // which writes the smaller file back to the same row. The push then
        // uses the URL of that smaller file — one round-trip to WP with the
        // compressed bytes rather than uploading twice.
        const result = await compressImage(imageUrl)
        const ext = result.format === 'webp' ? 'webp' : 'jpg'
        const form = new FormData()
        form.append('file', new File([result.blob], `compressed.${ext}`, { type: result.blob.type }))
        const cRes = await fetch(`/api/images/${imageId}/compress`, {
          method: 'POST',
          body: form,
        })
        const cData = await cRes.json()
        if (!cRes.ok) throw new Error(cData.error || 'Could not compress the image')
        urlToSend = cData.url
        compressedBytes = cData.bytes
        compressed = true
        if (result.overTarget) {
          toast(`Compressed to ${fileSize(cData.bytes)} — could not reach 1 MB without quality loss`, {
            icon: '⚠️',
            duration: 5000,
          })
        }
      }

      const res = await fetch('/api/images/push-to-wp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: urlToSend,
          site_id: siteId,
          alt: alt.trim() || fallbackAlt || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not send the image')

      const site = wpSites.find((s) => s.id === siteId)
      const suffix = compressed && compressedBytes ? ` (compressed to ${fileSize(compressedBytes)})` : ''
      toast.success(`Sent to ${site?.name || 'WordPress'} — media #${data.mediaId}${suffix}`)
      onSent?.({
        siteId,
        siteName: site?.name || '',
        mediaId: data.mediaId,
        compressed,
        sentUrl: urlToSend,
      })
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the image')
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Send to WordPress" maxWidth="max-w-md">
      <div className="space-y-4">
        <div className="rounded-xl overflow-hidden bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-700 flex items-center justify-center max-h-56">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={fallbackAlt || 'Image being sent to WordPress'}
            className="max-w-full max-h-56 object-contain"
          />
        </div>

        {!wpSites.length ? (
          <div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-900/10 p-4 text-sm text-amber-800 dark:text-amber-300">
            No WordPress sites connected yet. Add one in Sites to send images to
            its media library.
          </div>
        ) : (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Send to site
              </label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <select
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                  disabled={sending}
                  className="w-full appearance-none pl-10 pr-8 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {wpSites.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Alt description
                <span className="text-gray-400 font-normal"> (optional)</span>
              </label>
              <input
                type="text"
                value={alt}
                onChange={(e) => setAlt(e.target.value)}
                placeholder={fallbackAlt || 'Describe the image for accessibility and SEO'}
                disabled={sending}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Left blank, the image prompt is used as the alt.
              </p>
            </div>

            {/* Compress toggle. Never forced — the current size is right next
                to the switch, and the switch is off unless we already know
                the file is over the 1 MB target. Disabled with a hint when
                we don't have an image id to compress against. */}
            <label
              className={`flex items-start gap-3 p-3 rounded-xl border transition-colors ${
                compress
                  ? 'border-brand-300 dark:border-brand-800 bg-brand-50/40 dark:bg-brand-900/20'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
              } ${!canCompress ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <input
                type="checkbox"
                checked={compress}
                disabled={!canCompress || sending}
                onChange={(e) => setCompress(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-white">
                  <Minimize2 className="w-3.5 h-3.5 text-gray-400" />
                  Compress before sending
                </span>
                <span className="block text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  {imageBytes !== null && imageBytes !== undefined ? (
                    <>Current size <span className="font-medium">{fileSize(imageBytes)}</span>. </>
                  ) : null}
                  {canCompress
                    ? 'Targets under 1 MB, keeps quality high, prefers WebP.'
                    : 'Save the image to the library first to compress it.'}
                </span>
              </span>
            </label>
          </>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={send}
            disabled={sending || !wpSites.length || !siteId}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 transition-colors disabled:opacity-50"
          >
            {sending
              ? <><Loader2 className="w-4 h-4 animate-spin" />{compress ? 'Compressing & sending…' : 'Sending…'}</>
              : <><Send className="w-4 h-4" />Send to WordPress</>}
          </button>
        </div>
      </div>
    </Modal>
  )
}
