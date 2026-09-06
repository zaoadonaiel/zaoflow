'use client'

import { useState, useEffect } from 'react'
import { Star, ChevronDown, ExternalLink, Pencil, X } from 'lucide-react'
import { IMAGE_GEN_MODELS } from '@/lib/image-gen'
import Modal from '@/components/ui/Modal'

const FAVORITES_KEY = 'zaoflo_favorites_image'
const HIDDEN_KEY = 'zaoflo_hidden_image_models'
const CUSTOM_HISTORY_KEY = 'zaoflo_custom_image_models'
export const LAST_IMG_MODEL_KEY = 'zaoflo_last_model_image'

interface Props {
  value: string
  onChange: (model: string) => void
  className?: string
}

interface ImgModel { id: string; name: string; badge?: string }

interface ImgPricing {
  inputPerM: number
  outputPerM: number
  perImage: number | null
  contextLength: number | null
}

// Shared across every ImageModelSelect on the page so one request feeds them
// all and reopening the picker is instant.
let pricingCache: Record<string, ImgPricing> = {}
const inFlight = new Map<string, Promise<Record<string, ImgPricing>>>()

function loadPricing(customId?: string): Promise<Record<string, ImgPricing>> {
  const needsCustom = Boolean(customId) && !(customId! in pricingCache)
  const key = needsCustom ? customId! : '__catalogue__'

  if (!needsCustom && Object.keys(pricingCache).length > 0) {
    return Promise.resolve(pricingCache)
  }
  const existing = inFlight.get(key)
  if (existing) return existing

  const qs = needsCustom
    ? `?ids=${encodeURIComponent([customId!, ...IMAGE_GEN_MODELS.map((m) => m.id)].join(','))}`
    : `?ids=${encodeURIComponent(IMAGE_GEN_MODELS.map((m) => m.id).join(','))}`

  const request = fetch(`/api/models${qs}`)
    .then((r) => r.json())
    .then((d) => {
      pricingCache = { ...pricingCache, ...(d.pricing || {}) }
      return pricingCache
    })
    .catch(() => pricingCache)
    .finally(() => { inFlight.delete(key) })

  inFlight.set(key, request)
  return request
}

function formatPerM(value: number): string {
  if (value === 0) return 'Free'
  if (value < 0.01) return '<$0.01'
  return `$${value.toFixed(2)}`
}

function formatPerImage(value: number): string {
  if (value === 0) return 'Free'
  if (value < 0.001) return '<$0.001'
  if (value < 0.01) return `$${value.toFixed(3)}`
  return `$${value.toFixed(2)}`
}

function priceSummary(p?: ImgPricing): string | null {
  if (!p) return null
  if (p.perImage !== null) return `${formatPerImage(p.perImage)} / image`
  if (p.inputPerM > 0 || p.outputPerM > 0) {
    return `${formatPerM(p.inputPerM)} in / ${formatPerM(p.outputPerM)} out /M`
  }
  return null
}

export default function ImageModelSelect({ value, onChange, className }: Props) {
  const [open, setOpen] = useState(false)
  const [favorites, setFavorites] = useState<string[]>([])
  const [hidden, setHidden] = useState<string[]>([])
  const [customHistory, setCustomHistory] = useState<ImgModel[]>([])
  const [customDraft, setCustomDraft] = useState('')
  const [pricing, setPricing] = useState<Record<string, ImgPricing>>(pricingCache)
  const [pricingLoading, setPricingLoading] = useState(Object.keys(pricingCache).length === 0)

  useEffect(() => {
    try {
      const f = localStorage.getItem(FAVORITES_KEY)
      if (f) setFavorites(JSON.parse(f))
      const h = localStorage.getItem(HIDDEN_KEY)
      if (h) setHidden(JSON.parse(h))
      const c = localStorage.getItem(CUSTOM_HISTORY_KEY)
      if (c) setCustomHistory(JSON.parse(c))
    } catch {}
  }, [])

  // The trigger shows a price now, so pricing has to load before the modal is
  // opened. Re-runs when a custom id becomes the value so its price is fetched
  // alongside the catalogue.
  useEffect(() => {
    let active = true
    const isCustom = Boolean(value) && !IMAGE_GEN_MODELS.some((m) => m.id === value)
    loadPricing(isCustom ? value : undefined).then((p) => {
      if (!active) return
      setPricing({ ...p })
      setPricingLoading(false)
    })
    return () => { active = false }
  }, [value])

  // Any custom id that reaches the picker as `value` gets pinned so it lives
  // on next time the modal opens — a model used once should be a click away
  // to use again.
  useEffect(() => {
    if (!value) return
    const known = IMAGE_GEN_MODELS.some((m) => m.id === value)
    if (known) return
    setCustomHistory((prev) => {
      if (prev.some((m) => m.id === value)) return prev
      const next = [...prev, { id: value, name: value }]
      try { localStorage.setItem(CUSTOM_HISTORY_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [value])

  function saveFavorites(next: string[]) {
    setFavorites(next)
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(next)) } catch {}
  }

  function saveHidden(next: string[]) {
    setHidden(next)
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(next)) } catch {}
  }

  function saveCustomHistory(next: ImgModel[]) {
    setCustomHistory(next)
    try { localStorage.setItem(CUSTOM_HISTORY_KEY, JSON.stringify(next)) } catch {}
  }

  function toggleFav(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    saveFavorites(favorites.includes(id) ? favorites.filter((f) => f !== id) : [...favorites, id])
  }

  function hideModel(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (!hidden.includes(id)) saveHidden([...hidden, id])
    // Also remove from favorites so an unhide later does not resurrect the
    // gold-star with no context, and drop from custom history so a bare
    // custom id does not silently reappear the next time the modal opens.
    if (favorites.includes(id)) saveFavorites(favorites.filter((f) => f !== id))
    if (customHistory.some((m) => m.id === id)) {
      saveCustomHistory(customHistory.filter((m) => m.id !== id))
    }
    // Clearing the value only if this was the picked model, so hiding another
    // model does not blank out an image the user was about to regenerate.
    if (value === id) onChange('')
  }

  function selectModel(id: string) {
    onChange(id)
    try { localStorage.setItem(LAST_IMG_MODEL_KEY, id) } catch {}
    setOpen(false)
  }

  function applyCustom() {
    const id = customDraft.trim()
    if (!id) return
    if (hidden.includes(id)) saveHidden(hidden.filter((h) => h !== id))
    if (!customHistory.some((m) => m.id === id) && !IMAGE_GEN_MODELS.some((m) => m.id === id)) {
      saveCustomHistory([...customHistory, { id, name: id }])
    }
    selectModel(id)
    setCustomDraft('')
  }

  // Trigger label reflects whatever is currently picked, even for a custom id
  // the modal has not seen yet.
  const known = IMAGE_GEN_MODELS.find((m) => m.id === value)
  const currentName = known?.name || value || 'Select a model'
  const isFavourite = favorites.includes(value)

  // The visible list = hardcoded catalogue + every custom id that has stuck
  // around, minus anything the user has hidden.
  const allModels: ImgModel[] = [
    ...IMAGE_GEN_MODELS.map((m) => ({ id: m.id, name: m.name, badge: m.badge })),
    ...customHistory.filter((m) => !IMAGE_GEN_MODELS.some((h) => h.id === m.id)),
  ]
  const visible = allModels.filter((m) => !hidden.includes(m.id))
  const favoriteModels = visible.filter((m) => favorites.includes(m.id))
  const otherModels = visible.filter((m) => !favorites.includes(m.id))

  const currentSummary = priceSummary(pricing[value])

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-500 text-left text-gray-900 dark:text-gray-100"
      >
        {isFavourite && <Star className="w-3 h-3 text-yellow-400 fill-yellow-400 shrink-0" />}
        <span className="flex-1 truncate">{currentName}</span>
        {currentSummary && (
          <span className="shrink-0 text-xs font-mono text-gray-400 dark:text-gray-500">
            {currentSummary}
          </span>
        )}
        <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Choose an image model" maxWidth="max-w-2xl">
        <div className="space-y-5">
          <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1">
            Every model you use is pinned here so you can pick it again later. Tap the × on a card to remove one you do not like.
          </p>

          {favoriteModels.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                Favorites
              </h3>
              <ImgModelGrid
                models={favoriteModels}
                value={value}
                favorites={favorites}
                pricing={pricing}
                pricingLoading={pricingLoading}
                onSelect={selectModel}
                onToggleFav={toggleFav}
                onHide={hideModel}
              />
            </div>
          )}

          {otherModels.length > 0 && (
            <div className="space-y-2">
              {favoriteModels.length > 0 && (
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">All models</h3>
              )}
              <ImgModelGrid
                models={otherModels}
                value={value}
                favorites={favorites}
                pricing={pricing}
                pricingLoading={pricingLoading}
                onSelect={selectModel}
                onToggleFav={toggleFav}
                onHide={hideModel}
              />
            </div>
          )}

          <div className="border-t border-gray-100 dark:border-gray-700 pt-4 space-y-2">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <Pencil className="w-3 h-3" />
              Add another model
            </h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={customDraft}
                onChange={(e) => setCustomDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyCustom() } }}
                placeholder="e.g. openai/gpt-image-1"
                className="flex-1 min-w-0 px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
              />
              <button
                type="button"
                onClick={applyCustom}
                disabled={!customDraft.trim()}
                className="shrink-0 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
              >
                Use
              </button>
            </div>
            <a
              href="https://openrouter.ai/models?output_modalities=image"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400 hover:underline"
            >
              <ExternalLink className="w-3 h-3" />
              Browse all OpenRouter image models
            </a>

            {hidden.length > 0 && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => saveHidden([])}
                  className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                >
                  Restore {hidden.length} hidden model{hidden.length === 1 ? '' : 's'}
                </button>
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}

function ImgModelGrid({
  models, value, favorites, pricing, pricingLoading, onSelect, onToggleFav, onHide,
}: {
  models: ImgModel[]
  value: string
  favorites: string[]
  pricing: Record<string, ImgPricing>
  pricingLoading: boolean
  onSelect: (id: string) => void
  onToggleFav: (id: string, e: React.MouseEvent) => void
  onHide: (id: string, e: React.MouseEvent) => void
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {models.map((m) => (
        <ImgModelCard
          key={m.id}
          model={m}
          price={pricing[m.id]}
          priceLoading={pricingLoading}
          selected={value === m.id}
          isFav={favorites.includes(m.id)}
          onSelect={() => onSelect(m.id)}
          onToggleFav={(e) => onToggleFav(m.id, e)}
          onHide={(e) => onHide(m.id, e)}
        />
      ))}
    </div>
  )
}

function ImgModelCard({
  model, price, priceLoading, isFav, selected, onSelect, onToggleFav, onHide,
}: {
  model: ImgModel
  price?: ImgPricing
  priceLoading: boolean
  isFav: boolean
  selected: boolean
  onSelect: () => void
  onToggleFav: (e: React.MouseEvent) => void
  onHide: (e: React.MouseEvent) => void
}) {
  // Per-image models get a single wide cell; token-priced models get input +
  // output side by side so the two prices can be compared at a glance.
  const showPerImage = price?.perImage !== null && price?.perImage !== undefined
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onSelect}
        className={`w-full text-left rounded-xl border p-3 transition-colors ${
          selected
            ? 'border-brand-400 dark:border-brand-700 bg-brand-50 dark:bg-brand-900/20'
            : 'border-gray-200 dark:border-gray-700 hover:border-brand-300 dark:hover:border-brand-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'
        }`}
      >
        <div className="flex items-start gap-2 pr-14">
          <span
            className={`text-sm font-medium truncate ${
              selected ? 'text-brand-700 dark:text-brand-400' : 'text-gray-900 dark:text-gray-100'
            }`}
          >
            {model.name}
          </span>
          {model.badge && (
            <span className="shrink-0 text-[10px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded font-medium">
              {model.badge}
            </span>
          )}
        </div>
        <div className="text-[10px] text-gray-400 dark:text-gray-500 font-mono mt-2 truncate pr-14">
          {model.id}
        </div>
        {showPerImage ? (
          <div className="mt-2">
            <ImgPriceCell label="Per image" value={price!.perImage!} loading={priceLoading} kind="image" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <ImgPriceCell label="Input" value={price?.inputPerM} loading={priceLoading} kind="token" />
            <ImgPriceCell label="Output" value={price?.outputPerM} loading={priceLoading} kind="token" />
          </div>
        )}
      </button>

      <button
        type="button"
        onClick={onToggleFav}
        aria-label={isFav ? `Remove ${model.name} from favorites` : `Add ${model.name} to favorites`}
        title={isFav ? 'Remove from favorites' : 'Add to favorites'}
        className="absolute top-2 right-8 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
      >
        <Star
          className={`w-4 h-4 transition-colors ${
            isFav ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300 dark:text-gray-600 hover:text-yellow-400'
          }`}
        />
      </button>
      <button
        type="button"
        onClick={onHide}
        aria-label={`Remove ${model.name} from the picker`}
        title="Remove from picker"
        className="absolute top-2 right-2 p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-gray-300 dark:text-gray-600 hover:text-red-500 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

function ImgPriceCell({
  label,
  value,
  loading,
  kind,
}: {
  label: string
  value?: number
  loading: boolean
  kind: 'token' | 'image'
}) {
  const suffix = kind === 'image' ? ' /img' : ' /M'
  const format = kind === 'image' ? formatPerImage : formatPerM
  return (
    <div className="rounded-lg bg-white dark:bg-gray-900/40 border border-gray-100 dark:border-transparent px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
        {label}
      </div>
      <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 font-mono">
        {value === undefined ? (
          <span className="text-gray-300 dark:text-gray-600">{loading ? '···' : '—'}</span>
        ) : (
          <>
            {format(value)}
            {value > 0 && (
              <span className="text-gray-400 dark:text-gray-500 font-normal">{suffix}</span>
            )}
          </>
        )}
      </div>
    </div>
  )
}
