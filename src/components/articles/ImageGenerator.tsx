'use client'

import { useState, useEffect, useRef } from 'react'
import { Image, Images, Loader2, RefreshCw, Download, Send, Wand2, X, ZoomIn, Users, Type, Camera, Palette, SlidersHorizontal, Eraser } from 'lucide-react'
import { getSizesForModel, getDefaultSize } from '@/lib/image-gen'
import ImageModelSelect, { LAST_IMG_MODEL_KEY } from '@/components/ui/ImageModelSelect'
import MediaLibraryModal from '@/components/articles/MediaLibraryModal'
import Modal from '@/components/ui/Modal'
import type { GeneratedImage } from '@/types'
import toast from 'react-hot-toast'

const GROUP_SIZES = ['One person', 'More than one person'] as const
const AGE_RANGES = ['20-30', '30-40', '40-50', '50-60', '60-70', '70+'] as const
const EXPRESSIONS = ['Serious', 'Laughing', 'Smiling', 'Surprised', 'Shocked', 'Sad', 'Stressed'] as const
const ERAS = ['Modern', "Early 2000's", '1950s', '1960-1970', '1980s', '1990s'] as const
const CLASSES = ['Professional', 'Middle-class', 'Luxury'] as const
const LOCATIONS = ['New York', 'Hawaii', 'Miami', 'Los Angeles', 'Atlanta', 'Puerto Rico', 'Midwest', 'Chicago'] as const
const SETTINGS = ['Indoor', 'Outdoor'] as const

interface Filters {
  groupSize: string | null
  ageRange: string | null
  expression: string | null
  era: string | null
  socioClass: string | null
  location: string | null
  setting: string | null
}

const EMPTY_FILTERS: Filters = {
  groupSize: null, ageRange: null, expression: null, era: null,
  socioClass: null, location: null, setting: null,
}

interface Props {
  articleId?: string
  articleTitle?: string
  /** Site the article belongs to. Reserved for future per-site image settings. */
  siteId?: string
  defaultPrompt?: string
  /**
   * The user's most-used image model. Preferred over localStorage's
   * last-used, so a fresh article opens on the habit rather than the last
   * one-off pick.
   */
  defaultModel?: string
  /**
   * The article's city — auto-fills the location filter so the featured
   * image matches wherever the article is anchored. User can still
   * override in the Filters modal; the next city change re-syncs.
   */
  city?: string
  /** Restores previously generated image state when re-opening an article. */
  initialImageUrl?: string
  initialPrompt?: string
  initialAlt?: string
  /**
   * 4th arg is the usage row ids so the parent can bill against the article on
   * save; the 5th is the full records so the receipt panel can itemise the
   * call without a re-fetch. Both optional for compatibility.
   */
  onImageGenerated?: (
    url: string,
    prompt: string,
    altText: string,
    usageIds?: string[] | string | null,
    records?: import('@/lib/ai-cost').UsageRecord[] | null,
    /**
     * generated_images row id, when the image has one — set on fresh
     * generations and library picks, absent on plain alt updates. Downstream
     * flows (e.g. compress-before-send) need this to address the row.
     */
    imageId?: string | null,
  ) => void
  /**
   * Card heading, when the same generator is reused outside the article
   * editor. Defaults to "Featured Image" for the article-form case where the
   * component was born.
   */
  heading?: string
}

export default function ImageGenerator({
  articleId,
  articleTitle = '',
  siteId,
  defaultPrompt = '',
  defaultModel,
  city,
  initialImageUrl = '',
  initialPrompt = '',
  initialAlt = '',
  onImageGenerated,
  heading = 'Featured Image',
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
  // Realistic on, illustration off by default — the writer publishes photo-led
  // posts and does not want a stray drawing landing on the article. Turning
  // exactly one off forces the other; both off is treated as "no preference"
  // so a stray double-tap does not produce a contradictory prompt.
  const [allowRealistic, setAllowRealistic] = useState(true)
  const [allowIllustration, setAllowIllustration] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [customLocation, setCustomLocation] = useState('')
  const altRef = useRef<HTMLInputElement>(null)

  // Sync the location filter to the article's city. Overwrites any manual
  // pick on purpose — the user's spec is "if user changes city, region
  // updates". The user can still ovveride in the Filters modal after; the
  // next city change wins again.
  useEffect(() => {
    if (typeof city === 'string') {
      setFilters((prev) => ({ ...prev, location: city.trim() || null }))
    }
  }, [city])

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    // Clicking the active chip clears it — "choose one" means one, or none.
    setFilters((prev) => ({ ...prev, [key]: prev[key] === value ? null : value }))
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS)
    setAllowPeople(false)
    setAllowWords(false)
    setAllowRealistic(true)
    setAllowIllustration(false)
  }

  const activeFilterCount =
    (Object.values(filters).filter(Boolean).length) +
    (allowPeople ? 1 : 0) + (allowWords ? 1 : 0) +
    // Realistic/Illustration are only "on" (i.e., filtering) when exactly one
    // of the two is chosen; both on or both off adds no constraint.
    ((allowRealistic ? 1 : 0) + (allowIllustration ? 1 : 0) === 1 ? 1 : 0)

  // Most-used wins over localStorage last-used; the localStorage read is the
  // fallback for users with no image-generation history yet. Hydration-safe:
  // localStorage is not read during render, so the first client HTML matches
  // the server.
  useEffect(() => {
    if (defaultModel) {
      setModel(defaultModel)
      setSize(getDefaultSize(defaultModel))
      return
    }
    let saved = ''
    try { saved = localStorage.getItem(LAST_IMG_MODEL_KEY) || '' } catch {}
    if (saved) {
      setModel(saved)
      setSize(getDefaultSize(saved))
    }
  }, [defaultModel])

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
  // Person-shape filters (group, age, expression) only apply when People is on
  // so we do not describe a face for an image that is not supposed to have one.
  function buildPrompt(base: string): string {
    const parts: string[] = [base.trim()]

    if (allowPeople) {
      if (filters.groupSize === 'One person') parts.push('A single person in the frame')
      else if (filters.groupSize === 'More than one person') parts.push('A group of people in the frame')
      if (filters.ageRange) parts.push(`Aged ${filters.ageRange}`)
      if (filters.expression) parts.push(`${filters.expression} expression`)
    }
    if (filters.era) parts.push(filters.era === 'Modern' ? 'Modern-day aesthetic' : `${filters.era} aesthetic and fashion`)
    if (filters.socioClass) parts.push(`${filters.socioClass} styling, clothing and setting details`)
    if (filters.location) parts.push(`Set in ${filters.location} — reflect the atmosphere and cultural context`)
    if (filters.setting) parts.push(filters.setting === 'Indoor' ? 'Indoor scene' : 'Outdoor scene')

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
      onImageGenerated?.(data.imageUrl, data.prompt, newAlt, data.usage_ids, data.receipt, data.imageId ?? null)
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
    onImageGenerated?.(image.url, image.prompt || prompt, newAlt, null, null, image.id)

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

      {/* Sidebar card — prompt + toggles are inline so mobile users can drive
          image generation without ever opening the modal. The modal is kept for
          model/size selection, the library, and post-generation edits. */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <Image className="w-4 h-4 text-gray-400" />
          {heading}
        </h3>

        {imageUrl && (
          <>
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
          </>
        )}

        {/* Model + size inline so the initial generation does not require
            opening the modal — matches how the text article picker sits in
            the main editor. Stacked on mobile so the model name + price get
            the full row instead of being crushed into a half-width column. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            {imageUrl ? 'New prompt' : 'Prompt'}
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the image you want"
            rows={3}
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
          />
        </div>

        <ActiveFiltersSummary
          filters={filters}
          allowPeople={allowPeople}
          allowWords={allowWords}
          allowRealistic={allowRealistic}
          allowIllustration={allowIllustration}
        />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => generate()}
            disabled={generating}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-brand-600 text-white text-xs font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
          >
            {generating
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Generating…</>
              : <><Wand2 className="w-3.5 h-3.5" />{imageUrl ? 'Regenerate' : 'Generate'}</>}
          </button>
          <button
            type="button"
            onClick={() => setShowFilters(true)}
            aria-label="Image filters"
            className="relative flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filters
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[1.15rem] h-[1.15rem] px-1 flex items-center justify-center rounded-full bg-brand-600 text-white text-[10px] font-semibold">
                {activeFilterCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <Wand2 className="w-3.5 h-3.5" />
            More
          </button>
        </div>
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

          <div className="flex flex-wrap items-center gap-2 justify-between">
            <button
              type="button"
              onClick={() => { setShowModal(false); setShowFilters(true) }}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-brand-600 dark:hover:text-brand-400"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Filters
              {activeFilterCount > 0 && (
                <span className="min-w-[1.15rem] h-[1.15rem] px-1 flex items-center justify-center rounded-full bg-brand-600 text-white text-[10px] font-semibold">
                  {activeFilterCount}
                </span>
              )}
            </button>
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

      <Modal
        open={showFilters}
        onClose={() => setShowFilters(false)}
        title="Image filters"
        maxWidth="max-w-2xl"
      >
        <div className="space-y-5">
          <FilterSection title="Style">
            <div className="grid grid-cols-2 gap-2">
              <ToggleButton pressed={allowPeople} onClick={() => setAllowPeople((v) => !v)} icon={<Users className="w-3.5 h-3.5" />}>
                People {allowPeople ? 'on' : 'off'}
              </ToggleButton>
              <ToggleButton pressed={allowWords} onClick={() => setAllowWords((v) => !v)} icon={<Type className="w-3.5 h-3.5" />}>
                Words {allowWords ? 'on' : 'off'}
              </ToggleButton>
              <ToggleButton pressed={allowRealistic} onClick={() => setAllowRealistic((v) => !v)} icon={<Camera className="w-3.5 h-3.5" />}>
                Realistic {allowRealistic ? 'on' : 'off'}
              </ToggleButton>
              <ToggleButton pressed={allowIllustration} onClick={() => setAllowIllustration((v) => !v)} icon={<Palette className="w-3.5 h-3.5" />}>
                Illustration {allowIllustration ? 'on' : 'off'}
              </ToggleButton>
            </div>
            {allowRealistic && !allowIllustration && (
              <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">Forcing photorealistic — no illustrations.</p>
            )}
            {!allowRealistic && allowIllustration && (
              <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">Forcing illustration — no photographs.</p>
            )}
          </FilterSection>

          {/* Person-shape sections stay collapsed when People is off — describing
              a face for an image with no people just gets ignored by the model
              at best, or confuses it at worst. */}
          {allowPeople && (
            <>
              <FilterSection title="Group size">
                <ChipRow options={GROUP_SIZES} value={filters.groupSize} onSelect={(v) => setFilter('groupSize', v)} />
              </FilterSection>
              <FilterSection title="Age range">
                <ChipRow options={AGE_RANGES} value={filters.ageRange} onSelect={(v) => setFilter('ageRange', v)} />
              </FilterSection>
              <FilterSection title="Expression">
                <ChipRow options={EXPRESSIONS} value={filters.expression} onSelect={(v) => setFilter('expression', v)} />
              </FilterSection>
            </>
          )}

          <FilterSection title="Era / style">
            <ChipRow options={ERAS} value={filters.era} onSelect={(v) => setFilter('era', v)} />
          </FilterSection>
          <FilterSection title="Socioeconomic class">
            <ChipRow options={CLASSES} value={filters.socioClass} onSelect={(v) => setFilter('socioClass', v)} />
          </FilterSection>
          <FilterSection title="Location">
            {/* A custom city typed on the article surfaces at the head of the
                row so it can be cleared with a click, same as any predefined
                option — the "choose one" semantics stay honest. */}
            <ChipRow
              options={
                filters.location && !(LOCATIONS as readonly string[]).includes(filters.location)
                  ? [filters.location, ...LOCATIONS]
                  : LOCATIONS
              }
              value={filters.location}
              onSelect={(v) => setFilter('location', v)}
            />
            <input
              type="text"
              value={customLocation}
              onChange={(e) => setCustomLocation(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const v = customLocation.trim()
                  if (!v) return
                  setFilters((prev) => ({ ...prev, location: v }))
                  setCustomLocation('')
                }
              }}
              onBlur={() => {
                const v = customLocation.trim()
                if (!v) return
                setFilters((prev) => ({ ...prev, location: v }))
                setCustomLocation('')
              }}
              placeholder="Or type a city…"
              className="mt-2 w-full sm:max-w-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </FilterSection>
          <FilterSection title="Setting">
            <ChipRow options={SETTINGS} value={filters.setting} onSelect={(v) => setFilter('setting', v)} />
          </FilterSection>

          <div className="flex flex-col sm:flex-row gap-2 pt-3 border-t border-gray-100 dark:border-gray-700">
            <button
              type="button"
              onClick={clearFilters}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <Eraser className="w-4 h-4" />
              Clear filters
            </button>
            <button
              type="button"
              onClick={() => setShowFilters(false)}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border border-gray-200 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Done
            </button>
            <button
              type="button"
              onClick={() => { setShowFilters(false); generate() }}
              disabled={generating}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
            >
              <Wand2 className="w-4 h-4" />
              {imageUrl ? 'Regenerate' : 'Generate'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">{title}</label>
      {children}
    </div>
  )
}

function ToggleButton({
  pressed, onClick, icon, children,
}: {
  pressed: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={`flex items-center justify-center gap-2 py-2 rounded-lg border text-xs font-medium transition-colors ${
        pressed
          ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-400'
          : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}

function ChipRow({
  options, value, onSelect,
}: {
  options: readonly string[]
  value: string | null
  onSelect: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = value === opt
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onSelect(opt)}
            aria-pressed={active}
            className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
              active
                ? 'bg-brand-600 border-brand-600 text-white'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500'
            }`}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}

function ActiveFiltersSummary({
  filters, allowPeople, allowWords, allowRealistic, allowIllustration,
}: {
  filters: Filters
  allowPeople: boolean
  allowWords: boolean
  allowRealistic: boolean
  allowIllustration: boolean
}) {
  const chips: string[] = []
  if (allowPeople) chips.push('People')
  if (allowWords) chips.push('Words')
  // Only surface the style toggle when it will actually constrain — same rule
  // used in buildPrompt so the badge and the prompt cannot disagree.
  if (allowRealistic && !allowIllustration) chips.push('Realistic')
  else if (!allowRealistic && allowIllustration) chips.push('Illustration')
  for (const v of Object.values(filters)) if (v) chips.push(v)

  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((c) => (
        <span
          key={c}
          className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-700 text-[11px] text-gray-600 dark:text-gray-300"
        >
          {c}
        </span>
      ))}
    </div>
  )
}
