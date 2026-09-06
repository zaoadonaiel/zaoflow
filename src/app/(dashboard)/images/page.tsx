'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  Globe, Loader2, AlertTriangle, ImageIcon, Copy, Download, ExternalLink, X, Wand2, Send, Minimize2,
} from 'lucide-react'
import Header from '@/components/layout/Header'
import Modal from '@/components/ui/Modal'
import { ALL_SITES } from '@/lib/site-filter'
import { formatInZone } from '@/lib/timezone'
import { money, fileSize, tokens } from '@/lib/format'
import SitePills from '@/components/ui/SitePills'
import ImageUploadButton from '@/components/ui/ImageUploadButton'
import ImageGenerator from '@/components/articles/ImageGenerator'
import SendToWordPressModal from '@/components/images/SendToWordPressModal'
import { compressImage, TARGET_BYTES } from '@/lib/image-compression'
import type { GeneratedImage, Site } from '@/types'
import toast from 'react-hot-toast'

/** Images generated before their article was saved never got a site. */
const UNASSIGNED = 'unassigned'

/** Snapshot of what the standalone generator has produced in the current session. */
interface GeneratedShot {
  url: string
  prompt: string
  alt: string
  /** generated_images row id — needed so a compress-before-send can address it. */
  imageId: string | null
}

export default function ImagesPage() {
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState<string>(ALL_SITES)
  const [images, setImages] = useState<GeneratedImage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<GeneratedImage | null>(null)
  // Standalone generator modal — same ImageGenerator the article page uses,
  // without an article to attach the result to.
  const [showGenerator, setShowGenerator] = useState(false)
  // The image the generator has just produced in this session, held so the
  // "Send to a WordPress site" panel below the generator has something to push.
  const [lastShot, setLastShot] = useState<GeneratedShot | null>(null)
  // A library image the user picked "Send to site" on. Any card can drive the
  // same modal — one push flow, whether the image is fresh or from the archive.
  const [sendingImage, setSendingImage] = useState<GeneratedImage | null>(null)

  useEffect(() => {
    fetch('/api/sites')
      .then((r) => r.json())
      .then((d) => setSites(d.sites || []))
      .catch(() => toast.error('Could not load sites'))
  }, [])

  const fetchImages = useCallback(async () => {
    setLoading(true)
    try {
      const q = siteId && siteId !== ALL_SITES ? `?site_id=${encodeURIComponent(siteId)}` : ''
      const res = await fetch(`/api/images${q}`)
      const data = await res.json()
      // An empty grid on a failed request reads as "your images are gone".
      if (!res.ok) throw new Error(data.error || 'Could not load images')
      setImages(data.images || [])
      setLoadError(null)
    } catch (err) {
      setImages([])
      const msg = err instanceof Error ? err.message : 'Could not load images'
      setLoadError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [siteId])

  useEffect(() => { fetchImages() }, [fetchImages])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setLightbox(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Image URL copied')
    } catch {
      toast.error('Could not copy the URL')
    }
  }

  // The single id currently being compressed, so its own card can show a
  // spinner while everything else stays interactive.
  const [compressingId, setCompressingId] = useState<string | null>(null)
  async function compress(image: GeneratedImage) {
    if (compressingId) return
    setCompressingId(image.id)
    const toastId = toast.loading('Compressing…')
    try {
      const result = await compressImage(image.url)
      const form = new FormData()
      const ext = result.format === 'webp' ? 'webp' : 'jpg'
      form.append('file', new File([result.blob], `${image.id}.${ext}`, { type: result.blob.type }))

      const res = await fetch(`/api/images/${image.id}/compress`, {
        method: 'POST',
        body: form,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not save the compressed image')

      // Update this row in place so the new size/URL show without a full
      // refetch — the grid stays where it was, the card gets smaller.
      setImages((prev) => prev.map((i) =>
        i.id === image.id
          ? { ...i, url: data.url, storage_path: data.storage_path, bytes: data.bytes }
          : i,
      ))

      const before = result.originalBytes
      const after = data.bytes as number
      const pct = before ? Math.round(((before - after) / before) * 100) : 0
      const detail = [
        `${result.format.toUpperCase()} · quality ${Math.round(result.quality * 100)}%`,
        result.resized ? `resized to ${result.width}×${result.height}` : 'original dimensions kept',
      ].join(' · ')
      if (result.overTarget) {
        toast.error(
          `Compressed to ${fileSize(after)} (${pct}% smaller) — could not reach 1 MB without visible quality loss. ${detail}`,
          { id: toastId, duration: 8000 },
        )
      } else {
        toast.success(
          `Compressed: ${fileSize(before)} → ${fileSize(after)} (${pct}% smaller). ${detail}`,
          { id: toastId, duration: 6000 },
        )
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not compress the image', { id: toastId })
    } finally {
      setCompressingId(null)
    }
  }

  // Only counts what is actually known: images with no recorded cost are left
  // out rather than counted as free, so the total never understates quietly.
  const priced = images.filter((i) => i.cost_usd !== null && i.cost_usd !== undefined)
  const spend = priced.length ? priced.reduce((n, i) => n + (i.cost_usd ?? 0), 0) : null

  const scopeLabel =
    siteId === ALL_SITES ? 'any site'
      : siteId === UNASSIGNED ? 'images without a site'
      : sites.find((s) => s.id === siteId)?.name ?? 'this site'

  return (
    <>
      <Header
        title="Image Library"
        subtitle="Every image you have generated, newest first"
        actions={
          <button
            type="button"
            onClick={() => { setLastShot(null); setShowGenerator(true) }}
            className="flex items-center gap-2 bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            <Wand2 className="w-4 h-4" />
            Generate image
          </button>
        }
      />

      <div className="p-6">
        {/* The same pills as the articles list, so switching site works the
            same way in both places. */}
        <div className="mb-5">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="flex-1 min-w-0">
              {/* Pills wrap ungracefully on a phone; the same choices fit as a
                  native select on small screens and stay as pills on desktop. */}
              <div className="sm:hidden relative">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <select
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                  className="w-full appearance-none pl-10 pr-8 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent cursor-pointer"
                >
                  <option value={ALL_SITES}>All sites</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                  <option value={UNASSIGNED}>No site</option>
                </select>
              </div>
              <div className="hidden sm:block">
                <SitePills
                  sites={sites}
                  value={siteId}
                  onChange={setSiteId}
                  extra={[{ id: UNASSIGNED, name: 'No site' }]}
                />
              </div>
            </div>
            {/* The library is not only what the models made — a photograph or a
                client's own artwork belongs in the same place, and is pickable
                for an article from there like anything else. */}
            <ImageUploadButton
              multiple
              label="Upload images"
              siteId={siteId !== ALL_SITES && siteId !== UNASSIGNED ? siteId : null}
              onFinished={() => { void fetchImages() }}
              className="w-full sm:w-auto flex-shrink-0 flex items-center justify-center gap-1.5 px-4 py-2.5 sm:py-1.5 rounded-full border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-400 dark:hover:border-gray-500 transition-colors disabled:opacity-50"
            />
          </div>
          {!loading && !loadError && (
            <p className="text-xs text-gray-400 mt-2">
              {images.length} {images.length === 1 ? 'image' : 'images'}
              {spend !== null && <> · {money(spend)} spent</>}
            </p>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : loadError ? (
          <div className="rounded-2xl border border-red-200 dark:border-red-900/40 bg-red-50/50 dark:bg-red-900/10 py-12 px-6 text-center">
            <AlertTriangle className="w-7 h-7 text-red-500 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-900 dark:text-white">Could not load your images</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{loadError}</p>
            <p className="text-xs text-gray-400 mt-2">
              Nothing has been deleted — this is a read failure.
            </p>
            <button
              onClick={fetchImages}
              className="mt-4 bg-brand-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-brand-700"
            >
              Try again
            </button>
          </div>
        ) : !images.length ? (
          <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 py-16 text-center">
            <ImageIcon className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No images generated for {scopeLabel} yet.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {images.map((img) => (
              <ImageCard
                key={img.id}
                image={img}
                onZoom={() => setLightbox(img)}
                onCopy={() => copyUrl(img.url)}
                onSend={() => setSendingImage(img)}
                onCompress={() => compress(img)}
                compressing={compressingId === img.id}
              />
            ))}
          </div>
        )}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6"
          onClick={() => setLightbox(null)}
        >
          <button
            onClick={() => setLightbox(null)}
            aria-label="Close"
            className="absolute top-4 right-4 p-2 rounded-lg bg-white/10 text-white hover:bg-white/20"
          >
            <X className="w-5 h-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox.url}
            alt={lightbox.prompt || 'Generated image'}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full rounded-xl object-contain"
          />
        </div>
      )}

      {/* Standalone generator — the same ImageGenerator that sits in the
          article editor, opened here without an article to attach the result
          to. Every generation lands in the library on the API side, so
          closing the modal + a refresh is all that's needed to see it. */}
      <Modal
        open={showGenerator}
        onClose={() => setShowGenerator(false)}
        title="Generate an image"
        maxWidth="max-w-2xl"
      >
        <div className="space-y-4">
          <ImageGenerator
            heading="New image"
            siteId={siteId !== ALL_SITES && siteId !== UNASSIGNED ? siteId : undefined}
            onImageGenerated={(url, prompt, alt, _usageIds, _records, imageId) => {
              setLastShot({ url, prompt, alt, imageId: imageId ?? null })
              // Refresh in the background so the new image appears in the grid
              // behind the modal as soon as the user closes it.
              void fetchImages()
            }}
          />

          {lastShot && (
            <div className="rounded-xl border border-brand-200 dark:border-brand-900/40 bg-brand-50/40 dark:bg-brand-900/10 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                    Send this image to a WordPress site
                  </h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Uploads to the site&apos;s media library — nothing publishes
                    on its own.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSendingImage({
                    id: lastShot.imageId || 'pending',
                    url: lastShot.url,
                    prompt: lastShot.prompt,
                    created_at: new Date().toISOString(),
                  } as GeneratedImage)}
                  className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-700 transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                  Send to site
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {sendingImage && (
        <SendToWordPressModal
          open
          onClose={() => setSendingImage(null)}
          imageUrl={sendingImage.url}
          imageId={sendingImage.id !== 'pending' ? sendingImage.id : null}
          imageBytes={sendingImage.bytes}
          fallbackAlt={sendingImage.prompt || lastShot?.alt || null}
          sites={sites}
          defaultSiteId={
            sendingImage.site_id
            || (siteId !== ALL_SITES && siteId !== UNASSIGNED ? siteId : null)
          }
          onSent={({ compressed }) => {
            setSendingImage(null)
            // Both the generator's "Send" and the card's "Send" close the
            // outer generator modal too — one push, then back to the library.
            setShowGenerator(false)
            // A compressed send rewrote the library row, so pull the fresh
            // size/URL back before the user sees the grid again.
            if (compressed) void fetchImages()
          }}
        />
      )}
    </>
  )
}

interface CardProps {
  image: GeneratedImage
  onZoom: () => void
  onCopy: () => void
  onSend: () => void
  onCompress: () => void
  compressing: boolean
}

function ImageCard({ image, onZoom, onCopy, onSend, onCompress, compressing }: CardProps) {
  const iconBtn =
    'p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors'
  // Compression only makes sense above the 1 MB target — a smaller image gets
  // the button in the disabled state with a tooltip explaining why. Rows that
  // never carried a size (older uploads) still get the option, since we can
  // measure the file mid-flow and warn if it is already fine.
  const overTarget = (image.bytes ?? 0) > TARGET_BYTES
  const sizeKnown = image.bytes !== null && image.bytes !== undefined

  return (
    <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-800 overflow-hidden flex flex-col">
      <button
        onClick={onZoom}
        className="block aspect-video bg-gray-50 dark:bg-gray-900 overflow-hidden"
        title="View full size"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.url}
          alt={image.prompt || 'Generated image'}
          loading="lazy"
          className="w-full h-full object-cover hover:scale-[1.02] transition-transform"
        />
      </button>

      <div className="p-3 flex-1 flex flex-col gap-1.5">
        <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2" title={image.prompt || ''}>
          {image.prompt || <span className="italic text-gray-400">No prompt recorded</span>}
        </p>

        <p className="text-xs text-gray-400 flex items-center gap-1">
          <Globe className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">{image.sites?.name || 'No site'}</span>
        </p>

        {image.article_id && (
          <Link
            href={`/articles/${image.article_id}`}
            className="text-xs text-brand-600 dark:text-brand-400 hover:underline truncate"
            title={image.articles?.title || 'Open article'}
          >
            {image.articles?.title || 'Open article'}
          </Link>
        )}

        <ImageStats image={image} />

        <div className="mt-auto pt-1.5 flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-400 truncate" title={image.model || ''}>
            {formatInZone(image.created_at, 'PST')}
          </span>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button
              onClick={onCompress}
              disabled={compressing || (sizeKnown && !overTarget)}
              className={iconBtn}
              title={
                compressing
                  ? 'Compressing…'
                  : sizeKnown && !overTarget
                    ? `Already ${fileSize(image.bytes)} — under the 1 MB target`
                    : 'Compress to under 1 MB'
              }
            >
              {compressing
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Minimize2 className="w-3.5 h-3.5" />}
            </button>
            <button onClick={onSend} className={iconBtn} title="Send to a WordPress site">
              <Send className="w-3.5 h-3.5" />
            </button>
            <button onClick={onCopy} className={iconBtn} title="Copy image URL">
              <Copy className="w-3.5 h-3.5" />
            </button>
            <a
              href={image.url}
              download
              target="_blank"
              rel="noopener noreferrer"
              className={iconBtn}
              title="Download"
            >
              <Download className="w-3.5 h-3.5" />
            </a>
            <a
              href={image.url}
              target="_blank"
              rel="noopener noreferrer"
              className={iconBtn}
              title="Open in a new tab"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * What the image cost, and what it weighs.
 *
 * Every figure here distinguishes three states rather than two: a real number,
 * "not reported" when the model answered without one, and an em dash for the
 * images that predate any of this being recorded. Collapsing the last two into
 * $0.00 or 0 MB would claim an image was free, or empty.
 */
function ImageStats({ image }: { image: GeneratedImage }) {
  const hasTokenRecord = image.total_tokens !== null && image.total_tokens !== undefined
  const inTokens = image.prompt_tokens ?? 0
  const outTokens = image.completion_tokens ?? 0

  const tokenLine = !hasTokenRecord
    ? '—'
    : inTokens === 0 && outTokens === 0
    ? 'None reported'
    : `${tokens(inTokens)} in · ${tokens(outTokens)} out`

  return (
    <dl className="mt-1 grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5 text-[11px] leading-relaxed">
      <dt className="text-gray-400">Model</dt>
      <dd className="text-gray-600 dark:text-gray-300 font-mono truncate" title={image.model || ''}>
        {image.model || <span className="font-sans text-gray-400">—</span>}
      </dd>

      <dt className="text-gray-400">Cost</dt>
      <dd className="text-gray-900 dark:text-white font-medium">
        {money(image.cost_usd)}
        {image.cost_usd === null && (
          <span className="font-normal text-gray-400"> not priced</span>
        )}
      </dd>

      <dt className="text-gray-400">Tokens</dt>
      <dd className="text-gray-600 dark:text-gray-300">
        {tokenLine}
        {hasTokenRecord && (image.total_tokens ?? 0) > 0 && (
          <span className="text-gray-400"> ({tokens(image.total_tokens)} total)</span>
        )}
      </dd>

      <dt className="text-gray-400">Size</dt>
      <dd className="text-gray-600 dark:text-gray-300">{fileSize(image.bytes)}</dd>
    </dl>
  )
}
