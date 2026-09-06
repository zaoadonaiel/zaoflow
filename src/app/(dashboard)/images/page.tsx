'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  Globe, Loader2, AlertTriangle, ImageIcon, Copy, Download, ExternalLink, X,
} from 'lucide-react'
import Header from '@/components/layout/Header'
import { ALL_SITES } from '@/lib/site-filter'
import { formatInZone } from '@/lib/timezone'
import { money, fileSize, tokens } from '@/lib/format'
import SitePills from '@/components/ui/SitePills'
import ImageUploadButton from '@/components/ui/ImageUploadButton'
import type { GeneratedImage, Site } from '@/types'
import toast from 'react-hot-toast'

/** Images generated before their article was saved never got a site. */
const UNASSIGNED = 'unassigned'

export default function ImagesPage() {
  const [sites, setSites] = useState<Site[]>([])
  const [siteId, setSiteId] = useState<string>(ALL_SITES)
  const [images, setImages] = useState<GeneratedImage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<GeneratedImage | null>(null)

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
      />

      <div className="p-6">
        {/* The same pills as the articles list, so switching site works the
            same way in both places. */}
        <div className="mb-5">
          <div className="flex items-start justify-between gap-3">
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
              className="flex-shrink-0 flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-full border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-400 dark:hover:border-gray-500 transition-colors disabled:opacity-50"
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
    </>
  )
}

interface CardProps {
  image: GeneratedImage
  onZoom: () => void
  onCopy: () => void
}

function ImageCard({ image, onZoom, onCopy }: CardProps) {
  const iconBtn =
    'p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors'

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
