'use client'

import { useState, useEffect, useRef } from 'react'
import { Image, Images, Loader2, RefreshCw, Download, Send, Wand2, X, ZoomIn, Users, Type, Camera, Palette } from 'lucide-react'
import { getSizesForModel, getDefaultSize } from '@/lib/image-gen'
import ImageModelSelect, { LAST_IMG_MODEL_KEY } from '@/components/ui/ImageModelSelect'
import MediaLibraryModal from '@/components/articles/MediaLibraryModal'
import Modal from '@/components/ui/Modal'
import type { GeneratedImage } from '@/types'
import toast from 'react-hot-toast'

interface Props {
  articleId?: string
  articleTitle?: string
  /** Site the article belongs to. Reserved for future per-site image settings. */
  siteId?: string
  defaultPrompt?: string
  /** Restores previously generated image state when re-opening an article. */
  initialImageUrl?: string
  initialPrompt?: string
  initialAlt?: string
  /**
   * 4th arg is the usage row ids the image call produced, when the endpoint
   * eventually returns them, so the parent can bill the cost against the
   * article. Optional so it stays compatible with today's endpoint response.
   */
  onImageGenerated?: (
    url: string,
    prompt: string,
    altText: string,
    usageIds?: string[] | string | null,
  ) => void
}

export default function ImageGenerator({
  articleId,
  articleTitle = '',
  siteId,
  defaultPrompt = '',
  initialImageUrl = '',
  initialPrompt = '',
  initialAlt = '',
  onImageGenerated,
}: Props) {
  const [prompt, setPrompt] = useState(initialPrompt || defaultPrompt)
  // Start empty so the first client render matches the server HTML — reading
  // localStorage during render makes hydration fail once a model has been saved
  const [model, setModel] = useState('')
  const [size, setSize] = useState('1024x1024')
  const [imageUrl, setImageUrl] = useState(initialImageUrl)
  const [altText, setAltText] = useState(initialAlt)
  const [generating, setGenerating] = useState(false)
  const [editText, setEditText] = useState('')
  const [showEdit, setShowEdit] = useState(false)
  const [lightbox, setLightbox] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [showModal, setShowModal] = useState(false)
  // Off by default — the writer has said again and again that stock photos of
  // people and word-art overlays are not what these posts should carry.
  const [allowPeople, setAllowPeople] = useState(false)
  const [allowWords, setAllowWords] = useState(false)
  // Both on by default: no style constraint, let the model decide. Turning
  // exactly one off forces the other; both off is treated as "no preference"
  // so a stray double-tap does not produce a contradictory prompt.
  const [allowRealistic, setAllowRealistic] = useState(true)
  const [allowIllustration, setAllowIllustration] = useState(true)
  const altRef = useRef<HTMLInputElement>(null)

  // Restore the last-used model after hydration, not during render
  useEffect(() => {
    let saved = ''
    try { saved = localStorage.getItem(LAST_IMG_MODEL_KEY) || '' } catch {}
    if (saved) {
      setModel(saved)
      setSize(getDefaultSize(saved))
    }
  }, [])

  // Update prompt when articleTitle changes and prompt is still default/empty
  useEffect(() => {
    if (articleTitle && !imageUrl) {
      setPrompt(`Professional blog featured image for: ${articleTitle}`)
    }
  }, [articleTitle])

  function handleModelChange(newModel: string) {
    setModel(newModel)
    setSize(getDefaultSize(newModel))
  }

  // Toggled off means the model has to actively avoid the thing, not just be
  // asked to leave it out — negative constraints stack after the main brief.
  function buildPrompt(base: string): string {
    const parts: string[] = [base.trim()]
    if (!allowPeople) parts.push('No people, no human figures, no faces')
    if (!allowWords) parts.push('No text, no letters, no words, no writing')
    // Style toggles: only add a constraint when exactly one is off. Both off
    // is contradictory in principle and gets treated the same as both on.
    if (allowRealistic && !allowIllustration) {
      parts.push('Photorealistic photograph, 100% realistic. No illustration, no drawing, no cartoon, no painting, no sketch, no digital art')
    } else if (!allowRealistic && allowIllustration) {
      parts.push('Digital illustration or drawing, 100% illustrated. No photograph, no photorealistic imagery')
    }
    return parts.join('. ')
  }

  async function generate(customPrompt?: string) {
    const base = customPrompt || prompt
    if (!base.trim()) { toast.error('Enter an image prompt'); return }
    const finalPrompt = buildPrompt(base)
    setGenerating(true)
    try {
      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: finalPrompt, size, model, articleId, siteId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      const newAlt = articleTitle || finalPrompt.slice(0, 120)
      setImageUrl(data.imageUrl)
      setPrompt(data.prompt)
      setAltText(newAlt)
      setShowEdit(false)
      setEditText('')
      onImageGenerated?.(data.imageUrl, data.prompt, newAlt)
      toast.success('Image generated!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Image generation failed')
    } finally {
      setGenerating(false)
    }
  }

  /**
   * Takes an image that already exists rather than paying for another one.
   *
   * No usage ids go back to the form: this image was paid for when it was
   * generated, and attaching that cost to a second article would count the
   * same spend twice.
   */
  function selectFromLibrary(image: GeneratedImage) {
    // The alt is rebuilt rather than kept: whatever was in the box described
    // the image being replaced, and an alt that describes the wrong picture is
    // worse than an empty one.
    const newAlt = articleTitle || (image.prompt || '').slice(0, 120)

    setImageUrl(image.url)
    if (image.prompt) setPrompt(image.prompt)
    setAltText(newAlt)
    setShowEdit(false)
    setEditText('')
    setShowLibrary(false)
    setShowModal(false)
    onImageGenerated?.(image.url, image.prompt || prompt, newAlt)

    // Straight into the alt box, so the one thing that is usually wrong about
    // a reused image is the one thing your cursor lands on.
    requestAnimationFrame(() => {
      altRef.current?.focus()
      altRef.current?.select()
    })
    toast.success('Image selected — check the alt description before publishing.')
  }

  function handleEdit() {
    if (!editText.trim()) return
    generate(`${prompt}. ${editText}`)
  }

  function handleAltChange(val: string) {
    setAltText(val)
    if (imageUrl) onImageGenerated?.(imageUrl, prompt, val)
  }

  async function download() {
    if (!imageUrl) return
    const a = document.createElement('a')
    a.href = imageUrl
    a.download = `featured-image-${Date.now()}.jpg`
    a.target = '_blank'
    a.click()
  }

  const sizes = getSizesForModel(model)

  return (
    <>
      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
          onClick={() => setLightbox(false)}
        >
          <button
            className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            onClick={() => setLightbox(false)}
          >
            <X className="w-5 h-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={altText || 'Featured image preview'}
            className="max-w-[90vw] max-h-[90vh] rounded-xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Sidebar card — compact preview + trigger; every real control lives
          in the modal so the sidebar stays scannable. */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
          <Image className="w-4 h-4 text-gray-400" />
          Featured Image
        </h3>

        {imageUrl ? (
          <div className="space-y-2">
            <div
              className="relative rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 cursor-zoom-in group"
              onClick={() => setLightbox(true)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt={altText || 'Generated featured image'} className="w-full h-auto object-cover" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                <ZoomIn className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-lg" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Alt description</label>
              <input
                ref={altRef}
                type="text"
                value={altText}
                onChange={(e) => handleAltChange(e.target.value)}
                placeholder="Describe the image for accessibility and SEO"
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <Wand2 className="w-3.5 h-3.5" />
              Change image
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-brand-600 text-white text-xs font-medium hover:bg-brand-700 transition-colors"
          >
            <Wand2 className="w-3.5 h-3.5" />
            Generate featured image
          </button>
        )}
      </div>

      {/* Full-fidelity editor — model, size, prompt, toggles, preview, edit. */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Featured Image" maxWidth="max-w-2xl">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Model</label>
              <ImageModelSelect value={model} onChange={handleModelChange} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Size</label>
              <select
                value={size}
                onChange={(e) => setSize(e.target.value)}
                className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {sizes.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the image"
              rows={4}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Allow in image</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAllowPeople((v) => !v)}
                aria-pressed={allowPeople}
                className={`flex items-center justify-center gap-2 py-2 rounded-lg border text-xs font-medium transition-colors ${
                  allowPeople
                    ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-400'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                People {allowPeople ? 'on' : 'off'}
              </button>
              <button
                type="button"
                onClick={() => setAllowWords((v) => !v)}
                aria-pressed={allowWords}
                className={`flex items-center justify-center gap-2 py-2 rounded-lg border text-xs font-medium transition-colors ${
                  allowWords
                    ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-400'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'
                }`}
              >
                <Type className="w-3.5 h-3.5" />
                Words {allowWords ? 'on' : 'off'}
              </button>
              <button
                type="button"
                onClick={() => setAllowRealistic((v) => !v)}
                aria-pressed={allowRealistic}
                className={`flex items-center justify-center gap-2 py-2 rounded-lg border text-xs font-medium transition-colors ${
                  allowRealistic
                    ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-400'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'
                }`}
              >
                <Camera className="w-3.5 h-3.5" />
                Realistic {allowRealistic ? 'on' : 'off'}
              </button>
              <button
                type="button"
                onClick={() => setAllowIllustration((v) => !v)}
                aria-pressed={allowIllustration}
                className={`flex items-center justify-center gap-2 py-2 rounded-lg border text-xs font-medium transition-colors ${
                  allowIllustration
                    ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-400'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'
                }`}
              >
                <Palette className="w-3.5 h-3.5" />
                Illustration {allowIllustration ? 'on' : 'off'}
              </button>
            </div>
            {allowRealistic && !allowIllustration && (
              <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">Forcing photorealistic — no illustrations.</p>
            )}
            {!allowRealistic && allowIllustration && (
              <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">Forcing illustration — no photographs.</p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => generate()}
              disabled={generating}
              className="flex-1 flex items-center justify-center gap-2 bg-brand-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
            >
              {generating
                ? <><Loader2 className="w-4 h-4 animate-spin" />Generating…</>
                : <><Wand2 className="w-4 h-4" />Generate image</>}
            </button>
            <button
              type="button"
              onClick={() => setShowLibrary(true)}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <Images className="w-4 h-4" />
              Library
            </button>
          </div>

          {imageUrl && (
            <div className="space-y-3 pt-3 border-t border-gray-100 dark:border-gray-700">
              <div className="rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt={altText || 'Generated featured image'} className="w-full h-auto object-cover" />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Alt description</label>
                <input
                  type="text"
                  value={altText}
                  onChange={(e) => handleAltChange(e.target.value)}
                  placeholder="Describe the image for accessibility and SEO"
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => generate()}
                  disabled={generating}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className="w-3 h-3" />Regenerate
                </button>
                <button
                  type="button"
                  onClick={() => setShowEdit(!showEdit)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-lg border transition-colors ${
                    showEdit
                      ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-200 dark:border-brand-800 text-brand-700 dark:text-brand-400'
                      : 'text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <Send className="w-3 h-3" />Edit
                </button>
                <button
                  type="button"
                  onClick={download}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 transition-colors"
                >
                  <Download className="w-3 h-3" />
                </button>
              </div>

              {showEdit && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleEdit()}
                    placeholder="e.g. remove the woman, add a sunset background"
                    className="flex-1 px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <button
                    type="button"
                    onClick={handleEdit}
                    disabled={generating || !editText.trim()}
                    className="px-3 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
                  >
                    Apply
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      <MediaLibraryModal
        open={showLibrary}
        onClose={() => setShowLibrary(false)}
        onSelect={selectFromLibrary}
        currentUrl={imageUrl}
      />
    </>
  )
}
