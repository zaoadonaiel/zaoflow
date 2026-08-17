'use client'

import { useState, useEffect } from 'react'
import { Star, ChevronDown, ExternalLink, SlidersHorizontal } from 'lucide-react'
import { AVAILABLE_MODELS } from '@/lib/openrouter'
import Modal from '@/components/ui/Modal'

const FAVORITES_KEY = 'zaoflo_favorites_text'
export const LAST_MODEL_KEY = 'zaoflo_last_model_text'

interface ModelPricing {
  inputPerM: number
  outputPerM: number
  contextLength: number | null
}

interface Props {
  value: string
  onChange: (model: string) => void
  className?: string
  lastModelKey?: string
}

// Shared across every picker instance so the two on the New Article page make
// one request between them, and reopening is instant.
let pricingCache: Record<string, ModelPricing> | null = null
let pricingRequest: Promise<Record<string, ModelPricing>> | null = null

function loadPricing(): Promise<Record<string, ModelPricing>> {
  if (pricingCache) return Promise.resolve(pricingCache)
  if (!pricingRequest) {
    pricingRequest = fetch('/api/models')
      .then((r) => r.json())
      .then((d) => {
        pricingCache = d.pricing || {}
        return pricingCache as Record<string, ModelPricing>
      })
      .catch(() => ({}))
      .finally(() => {
        pricingRequest = null
      })
  }
  return pricingRequest
}

function formatPerM(value: number): string {
  if (value === 0) return 'Free'
  if (value < 0.01) return '<$0.01'
  return `$${value.toFixed(2)}`
}

export default function ModelSelect({
  value,
  onChange,
  className,
  lastModelKey = LAST_MODEL_KEY,
}: Props) {
  const [open, setOpen] = useState(false)
  const [favorites, setFavorites] = useState<string[]>([])
  const [customMode, setCustomMode] = useState(false)
  const [pricing, setPricing] = useState<Record<string, ModelPricing>>({})
  const [pricingLoading, setPricingLoading] = useState(false)

  const isKnown = AVAILABLE_MODELS.some((m) => m.id === value)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(FAVORITES_KEY)
      if (stored) setFavorites(JSON.parse(stored))
    } catch {}
  }, [])

  useEffect(() => {
    setCustomMode(!AVAILABLE_MODELS.some((m) => m.id === value))
  }, [value])

  // Only fetch once the picker is actually opened
  useEffect(() => {
    if (!open) return
    let active = true
    if (!pricingCache) setPricingLoading(true)
    loadPricing().then((p) => {
      if (!active) return
      setPricing(p)
      setPricingLoading(false)
    })
    return () => {
      active = false
    }
  }, [open])

  function saveFavorites(next: string[]) {
    setFavorites(next)
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next))
    } catch {}
  }

  function toggleFav(modelId: string, e: React.MouseEvent) {
    e.stopPropagation()
    saveFavorites(
      favorites.includes(modelId)
        ? favorites.filter((f) => f !== modelId)
        : [...favorites, modelId]
    )
  }

  function selectModel(id: string) {
    setCustomMode(false)
    onChange(id)
    if (!AVAILABLE_MODELS.some((m) => m.id === id)) {
      try {
        localStorage.setItem(lastModelKey, id)
      } catch {}
    }
    setOpen(false)
  }

  function chooseCustom() {
    setCustomMode(true)
    onChange('')
    setOpen(false)
  }

  const currentName = isKnown
    ? AVAILABLE_MODELS.find((m) => m.id === value)?.name
    : customMode
    ? value || 'Custom model…'
    : 'Select model…'

  const favoriteModels = AVAILABLE_MODELS.filter((m) => favorites.includes(m.id))
  const otherModels = AVAILABLE_MODELS.filter((m) => !favorites.includes(m.id))

  const renderGrid = (models: typeof AVAILABLE_MODELS) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {models.map((m) => (
        <ModelCard
          key={m.id}
          model={m}
          price={pricing[m.id]}
          priceLoading={pricingLoading}
          selected={value === m.id}
          isFav={favorites.includes(m.id)}
          onSelect={() => selectModel(m.id)}
          onToggleFav={(e) => toggleFav(m.id, e)}
        />
      ))}
    </div>
  )

  return (
    <div className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-500 text-left text-gray-900 dark:text-gray-100"
      >
        <span className="flex items-center gap-1.5 min-w-0">
          {favorites.includes(value) && (
            <Star className="w-3 h-3 text-yellow-400 fill-yellow-400 shrink-0" />
          )}
          <span className="truncate">{currentName}</span>
        </span>
        <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Choose an AI model"
        maxWidth="max-w-2xl"
      >
        <div className="space-y-5">
          <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1">
            Prices are per million tokens, live from OpenRouter. Input is what you send
            (title, keywords, instructions); output is the generated article.
          </p>

          {favoriteModels.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                Favorites
              </h3>
              {renderGrid(favoriteModels)}
            </div>
          )}

          <div className="space-y-2">
            {favoriteModels.length > 0 && (
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                All models
              </h3>
            )}
            {renderGrid(otherModels)}
          </div>

          <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
            <button
              type="button"
              onClick={chooseCustom}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-600 dark:text-gray-400 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Use a custom model
            </button>
          </div>
        </div>
      </Modal>

      {customMode && (
        <div className="mt-2 space-y-1.5">
          <input
            type="text"
            value={value}
            onChange={(e) => {
              onChange(e.target.value)
              try {
                localStorage.setItem(lastModelKey, e.target.value)
              } catch {}
            }}
            placeholder="e.g. anthropic/claude-opus-4"
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
          />
          <a
            href="https://openrouter.ai/models?categories=marketing/seo&order=most-popular"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400 hover:underline"
          >
            <ExternalLink className="w-3 h-3" />
            Browse top SEO models on OpenRouter
          </a>
        </div>
      )}
    </div>
  )
}

function ModelCard({
  model,
  price,
  priceLoading,
  isFav,
  selected,
  onSelect,
  onToggleFav,
}: {
  model: { id: string; name: string; badge: string }
  price?: ModelPricing
  priceLoading: boolean
  isFav: boolean
  selected: boolean
  onSelect: () => void
  onToggleFav: (e: React.MouseEvent) => void
}) {
  // The star sits beside the card button rather than inside it — a button
  // nested in a button is invalid HTML and breaks hydration.
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
        <div className="flex items-start gap-2 pr-7">
          <span
            className={`text-sm font-medium truncate ${
              selected
                ? 'text-brand-700 dark:text-brand-400'
                : 'text-gray-900 dark:text-gray-100'
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

        <div className="grid grid-cols-2 gap-2 mt-2.5">
          <PriceCell label="Input" value={price?.inputPerM} loading={priceLoading} />
          <PriceCell label="Output" value={price?.outputPerM} loading={priceLoading} />
        </div>
      </button>

      <button
        type="button"
        onClick={onToggleFav}
        aria-label={isFav ? `Remove ${model.name} from favorites` : `Add ${model.name} to favorites`}
        title={isFav ? 'Remove from favorites' : 'Add to favorites'}
        className="absolute top-2 right-2 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
      >
        <Star
          className={`w-4 h-4 transition-colors ${
            isFav ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300 dark:text-gray-600 hover:text-yellow-400'
          }`}
        />
      </button>
    </div>
  )
}

function PriceCell({
  label,
  value,
  loading,
}: {
  label: string
  value?: number
  loading: boolean
}) {
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">
        {label}
      </div>
      <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 font-mono">
        {value === undefined ? (
          <span className="text-gray-300 dark:text-gray-600">{loading ? '···' : '—'}</span>
        ) : (
          <>
            {formatPerM(value)}
            {value > 0 && (
              <span className="text-gray-400 dark:text-gray-500 font-normal"> /M</span>
            )}
          </>
        )}
      </div>
    </div>
  )
}
