'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ChevronLeft, ChevronRight, Loader2, AlertTriangle, ImageIcon, Check,
} from 'lucide-react'
import Modal from '@/components/ui/Modal'
import SitePills from '@/components/ui/SitePills'
import ImageUploadButton from '@/components/ui/ImageUploadButton'
import { ALL_SITES } from '@/lib/site-filter'
import { formatInZone } from '@/lib/timezone'
import type { GeneratedImage, Site } from '@/types'
import toast from 'react-hot-toast'

/** Images generated before their article was saved never got a site. */
const UNASSIGNED = 'unassigned'

interface Props {
  open: boolean
  onClose: () => void
  /** Hands back the picked image. Closing is the caller's to do. */
  onSelect: (image: GeneratedImage) => void
  /** Highlighted in the strip, so "the one already on this article" is findable. */
  currentUrl?: string
}

/**
 * Picking an image that already exists instead of paying for another one.
 *
 * Browsing is the whole point, so it is a carousel rather than a grid: one
 * image big enough to actually judge, arrows and the arrow keys to move
 * through them, and a strip underneath to jump. Selecting is deliberately not
 * the same gesture as browsing — a thumbnail moves you to an image, and only
 * the big one takes it.
 */
export default function MediaLibraryModal({ open, onClose, onSelect, currentUrl }: Props) {
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState<string>(ALL_SITES)
  const [images, setImages] = useState<GeneratedImage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    fetch('/api/sites')
      .then((r) => r.json())
      .then((d) => setSites(d.sites || []))
      .catch(() => {})
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)

    const q = siteId && siteId !== ALL_SITES ? `?site_id=${encodeURIComponent(siteId)}` : ''
    fetch(`/api/images${q}`)
      .then(async (r) => {
        const d = await r.json()
        // An empty strip on a failed request reads as "your images are gone".
        if (!r.ok) throw new Error(d.error || 'Could not load your images')
        return d.images || []
      })
      .then((list: GeneratedImage[]) => {
        if (cancelled) return
        setImages(list)
        setLoadError(null)
        // Open on the image this article is already using when it is in the
        // list, so the strip starts where you left off rather than at the top.
        const at = currentUrl ? list.findIndex((i) => i.url === currentUrl) : -1
        setIndex(at >= 0 ? at : 0)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setImages([])
        setLoadError(err instanceof Error ? err.message : 'Could not load your images')
      })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
    // currentUrl is read once per open, not tracked: re-running this because
    // the article's image changed would reload the library underneath you.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, siteId])

  const count = images.length

  // Wrapping on purpose: at 40 images the end of the list is not a wall you
  // want to be stopped by, and there is a counter saying where you are.
  const step = useCallback((by: number) => {
    setIndex((i) => (count ? (i + by + count) % count : 0))
  }, [count])

  const current = images[index]

  const choose = useCallback((image?: GeneratedImage) => {
    if (!image) return
    onSelect(image)
  }, [onSelect])

  // Arrows browse, Enter takes. Escape is Modal's own.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1) }
      else if (e.key === 'Enter') { e.preventDefault(); choose(images[index]) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, step, choose, images, index])

  /**
   * Picks an image out of the mosaic and brings it up to the stage.
   *
   * The stage is above the gallery, so on a long library it is off screen by
   * the time you find the one you want -- scrolling it back into view is the
   * difference between "that did nothing" and seeing the picture you clicked.
   */
  function showFromGallery(i: number) {
    setIndex(i)
    stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  const arrowBtn =
    'absolute top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full ' +
    'bg-black/50 text-white hover:bg-black/70 transition-colors disabled:opacity-30'

  return (
    <Modal open={open} onClose={onClose} title="Media library" maxWidth="max-w-4xl">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <SitePills
            sites={sites}
            value={siteId}
            onChange={setSiteId}
            extra={[{ id: UNASSIGNED, name: 'No site' }]}
          />
          {/* Straight onto the stage once it lands, because you uploaded it to
              use it — and tagged with the site the filter is on, so it files
              itself where you would look for it next time. */}
          <ImageUploadButton
            multiple
            label="Upload"
            siteId={siteId !== ALL_SITES && siteId !== UNASSIGNED ? siteId : null}
            onUploaded={(image) => {
              setImages((prev) => [image, ...prev])
              setIndex(0)
              setLoadError(null)
            }}
            className="flex-shrink-0 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-400 dark:hover:border-gray-500 transition-colors disabled:opacity-50"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : loadError ? (
          <div className="rounded-2xl border border-red-200 dark:border-red-900/40 bg-red-50/50 dark:bg-red-900/10 py-12 px-6 text-center">
            <AlertTriangle className="w-7 h-7 text-red-500 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-900 dark:text-white">Could not load your images</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{loadError}</p>
            <p className="text-xs text-gray-400 mt-2">Nothing has been deleted — this is a read failure.</p>
          </div>
        ) : !count ? (
          <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 py-20 text-center">
            <ImageIcon className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {siteId === ALL_SITES
                ? 'No images generated yet — the first one has to be generated.'
                : 'No images for this filter. Try All sites.'}
            </p>
          </div>
        ) : (
          <>
            {/* The stage. Clicking the image is the select, which is why it
                carries the cursor and the hover overlay and the strip does not. */}
            <div
              ref={stageRef}
              className="relative rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700"
            >
              <button
                type="button"
                onClick={() => choose(current)}
                className="group block w-full"
                title="Use this image"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={current.url}
                  alt={current.prompt || 'Image from your library'}
                  className="w-full max-h-[52vh] object-contain bg-gray-100 dark:bg-gray-900"
                />
                <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
                  <span className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-gray-900 text-sm font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                    <Check className="w-4 h-4" />
                    Use this image
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous image"
                className={`${arrowBtn} left-3`}
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next image"
                className={`${arrowBtn} right-3`}
              >
                <ChevronRight className="w-5 h-5" />
              </button>

              <span className="absolute bottom-3 right-3 px-2 py-1 rounded-md bg-black/60 text-white text-xs tabular-nums">
                {index + 1} / {count}
              </span>
            </div>

            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-gray-700 dark:text-gray-200 line-clamp-2" title={current.prompt || ''}>
                  {current.prompt || <span className="italic text-gray-400">No prompt recorded</span>}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {current.sites?.name || 'No site'} · {formatInZone(current.created_at, 'PST')}
                  {current.url === currentUrl && ' · already on this article'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => choose(current)}
                className="flex-shrink-0 flex items-center gap-2 bg-brand-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-brand-700 transition-colors"
              >
                <Check className="w-4 h-4" />
                Use this image
              </button>
            </div>

            <p className="text-xs text-gray-400">
              Click a picture below to bring it up top. Clicking the big one, or Enter,
              uses it — ← and → move through the library. You can rewrite the alt
              description after picking one.
            </p>

            {/* The whole library, laid out rather than filed away in a strip
                of thumbnails too small to recognise anything in. Three CSS
                columns rather than a grid, so each picture keeps its own
                shape instead of being cropped to a common cell -- and it runs
                to the bottom of the modal, which scrolls. */}
            <div className="columns-3 gap-3">
              {images.map((img, i) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => showFromGallery(i)}
                  aria-label={`Show image ${i + 1}`}
                  aria-current={i === index}
                  className={`mb-3 block w-full break-inside-avoid rounded-lg overflow-hidden border-2 transition-colors ${
                    i === index
                      ? 'border-brand-500'
                      : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.prompt || `Library image ${i + 1}`}
                    loading="lazy"
                    className="w-full h-auto"
                  />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
