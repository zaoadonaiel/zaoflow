'use client'

import { useState, useEffect } from 'react'
import { Star, ChevronDown, ExternalLink, Pencil, X } from 'lucide-react'
import { AVAILABLE_MODELS } from '@/lib/openrouter'
import Modal from '@/components/ui/Modal'

const FAVORITES_KEY = 'zaoflo_favorites_text'
const HIDDEN_KEY = 'zaoflo_hidden_text_models'
const CUSTOM_HISTORY_KEY = 'zaoflo_custom_text_models'
export const LAST_MODEL_KEY = 'zaoflo_last_model_text'

interface TextModel { id: string; name: string; badge: string }

const OPENROUTER_SEO_MODELS_URL =
  'https://openrouter.ai/models?categories=marketing/seo&order=most-popular'

interface ModelPricing {
  inputPerM: number
  outputPerM: number
  perImage: number | null
  contextLength: number | null
}

interface Props {
  value: string
  onChange: (model: string) => void
  className?: string
  lastModelKey?: string
  /** 'tile' is the standalone card; 'compact' is a single row for tight layouts */
  variant?: 'tile' | 'compact'
  /** Trailing button/element rendered beside the picker — e.g. a "Generate" action. */
  action?: React.ReactNode
}

// Shared across instances so the pickers on a page make one request between
// them, and reopening is instant.
let pricingCache: Record<string, ModelPricing> = {}
const inFlight = new Map<string, Promise<Record<string, ModelPricing>>>()

function loadPricing(customId?: string): Promise<Record<string, ModelPricing>> {
  const needsCustom = Boolean(customId) && !(customId! in pricingCache)
  const key = needsCustom ? customId! : '__catalogue__'

  if (!needsCustom && Object.keys(pricingCache).length > 0) {
    return Promise.resolve(pricingCache)
  }

  const existing = inFlight.get(key)
  if (existing) return existing

  const qs = needsCustom ? `?ids=${encodeURIComponent(customId!)}` : ''
  const request = fetch(`/api/models${qs}`)
    .then((r) => r.json())
    .then((d) => {
      pricingCache = { ...pricingCache, ...(d.pricing || {}) }
      return pricingCache
    })
    .catch(() => pricingCache)
    .finally(() => {
      inFlight.delete(key)
    })

  inFlight.set(key, request)
  return request
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
  variant = 'tile',
  action,
}: Props) {
  const [open, setOpen] = useState(false)
  const [favorites, setFavorites] = useState<string[]>([])
  const [hidden, setHidden] = useState<string[]>([])
  const [customHistory, setCustomHistory] = useState<TextModel[]>([])
  const [pricing, setPricing] = useState<Record<string, ModelPricing>>({})
  const [pricingLoading, setPricingLoading] = useState(true)
  const [customDraft, setCustomDraft] = useState('')

  const known = AVAILABLE_MODELS.find((m) => m.id === value)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(FAVORITES_KEY)
      if (stored) setFavorites(JSON.parse(stored))
      const h = localStorage.getItem(HIDDEN_KEY)
      if (h) setHidden(JSON.parse(h))
      const c = localStorage.getItem(CUSTOM_HISTORY_KEY)
      if (c) setCustomHistory(JSON.parse(c))
    } catch {}
  }, [])

  // Any custom id the picker sees as `value` gets pinned so it lives on next
  // time the modal opens — a model used once should be a click away to use
  // again, not a re-typed slug.
  useEffect(() => {
    if (!value) return
    if (AVAILABLE_MODELS.some((m) => m.id === value)) return
    setCustomHistory((prev) => {
      if (prev.some((m) => m.id === value)) return prev
      const next = [...prev, { id: value, name: value, badge: '' }]
      try { localStorage.setItem(CUSTOM_HISTORY_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [value])

  // The trigger shows a price now, so this can't wait for the modal to open.
  // Re-runs when a custom id is picked so its price gets fetched too.
  useEffect(() => {
    let active = true
    const isCustom = Boolean(value) && !AVAILABLE_MODELS.some((m) => m.id === value)
    loadPricing(isCustom ? value : undefined).then((p) => {
      if (!active) return
      setPricing({ ...p })
      setPricingLoading(false)
    })
    return () => {
      active = false
    }
  }, [value])

  // Seed the modal's custom field with the current custom model
  useEffect(() => {
    if (value && !AVAILABLE_MODELS.some((m) => m.id === value)) setCustomDraft(value)
  }, [value])

  function saveFavorites(next: string[]) {
    setFavorites(next)
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next))
    } catch {}
  }

  function saveHidden(next: string[]) {
    setHidden(next)
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(next)) } catch {}
  }

  function saveCustomHistory(next: TextModel[]) {
    setCustomHistory(next)
    try { localStorage.setItem(CUSTOM_HISTORY_KEY, JSON.stringify(next)) } catch {}
  }

  function toggleFav(modelId: string, e: React.MouseEvent) {
    e.stopPropagation()
    saveFavorites(
      favorites.includes(modelId)
        ? favorites.filter((f) => f !== modelId)
        : [...favorites, modelId]
    )
  }

  function hideModel(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (!hidden.includes(id)) saveHidden([...hidden, id])
    // Also drop from favorites so an unhide later does not resurrect the
    // gold-star with no context, and from custom history so a bare custom
    // id does not silently reappear on next open.
    if (favorites.includes(id)) saveFavorites(favorites.filter((f) => f !== id))
    if (customHistory.some((m) => m.id === id)) {
      saveCustomHistory(customHistory.filter((m) => m.id !== id))
    }
    if (value === id) onChange('')
  }

  function selectModel(id: string) {
    onChange(id)
    // Persist every pick, preset or custom, so reopening the article does not
    // silently reset the model choice to whatever the form defaulted to.
    try { localStorage.setItem(lastModelKey, id) } catch {}
    setOpen(false)
  }

  function applyCustom() {
    const id = customDraft.trim()
    if (id) selectModel(id)
  }

  const currentName = known?.name || value || 'Select a model'
  const currentPrice = pricing[value]
  const isFavourite = favorites.includes(value)

  // Visible list = hardcoded catalogue + every custom id ever used, minus
  // whatever the user has hidden.
  const allModels: TextModel[] = [
    ...AVAILABLE_MODELS,
    ...customHistory.filter((m) => !AVAILABLE_MODELS.some((h) => h.id === m.id)),
  ]
  const visible = allModels.filter((m) => !hidden.includes(m.id))
  const favoriteModels = visible.filter((m) => favorites.includes(m.id))
  const otherModels = visible.filter((m) => !favorites.includes(m.id))

  const renderGrid = (models: TextModel[]) => (
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
          onHide={(e) => hideModel(m.id, e)}
        />
      ))}
    </div>
  )

  const picker = variant === 'tile' ? (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 p-3 hover:border-brand-300 dark:hover:border-brand-700 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
    >
      <div className="flex items-center gap-1.5 min-w-0">
        {isFavourite && (
          <Star className="w-3 h-3 text-yellow-400 fill-yellow-400 shrink-0" />
        )}
        <span className="flex-1 text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
          {currentName}
        </span>
        <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
      </div>
      <div className="grid grid-cols-2 gap-2 mt-2.5">
        <PriceCell label="Input" value={currentPrice?.inputPerM} loading={pricingLoading} />
        <PriceCell label="Output" value={currentPrice?.outputPerM} loading={pricingLoading} />
      </div>
    </button>
  ) : (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-500 text-left text-gray-900 dark:text-gray-100"
    >
      {isFavourite && <Star className="w-3 h-3 text-yellow-400 fill-yellow-400 shrink-0" />}
      <span className="flex-1 truncate">{currentName}</span>
      {currentPrice && (
        <span className="shrink-0 text-xs font-mono text-gray-400 dark:text-gray-500">
          {formatPerM(currentPrice.inputPerM)} / {formatPerM(currentPrice.outputPerM)}
        </span>
      )}
      <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
    </button>
  )

  return (
    <div className={className}>
      {action ? (
        // Mobile: picker on top, action stretched full width underneath. On
        // sm+ they share a row so the button does not push the picker down
        // when there is room for both.
        <div className="flex flex-col sm:flex-row sm:items-stretch gap-2">
          <div className="flex-1 min-w-0">{picker}</div>
          <div className="shrink-0 flex items-stretch [&>*]:w-full sm:[&>*]:w-auto">{action}</div>
        </div>
      ) : picker}

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

          <div className="border-t border-gray-100 dark:border-gray-700 pt-4 space-y-2">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <Pencil className="w-3 h-3" />
              Custom model
            </h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={customDraft}
                onChange={(e) => setCustomDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    applyCustom()
                  }
                }}
                placeholder="e.g. openai/gpt-5.6-luna"
                className="flex-1 min-w-0 px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
              />
              <button
                type="button"
                onClick={applyCustom}
                disabled={!customDraft.trim() || customDraft.trim() === value}
                className="shrink-0 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
              >
                Use
              </button>
            </div>
            <a
              href={OPENROUTER_SEO_MODELS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400 hover:underline"
            >
              <ExternalLink className="w-3 h-3" />
              Browse top SEO models on OpenRouter
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

function ModelCard({
  model,
  price,
  priceLoading,
  isFav,
  selected,
  onSelect,
  onToggleFav,
  onHide,
}: {
  model: { id: string; name: string; badge: string }
  price?: ModelPricing
  priceLoading: boolean
  isFav: boolean
  selected: boolean
  onSelect: () => void
  onToggleFav: (e: React.MouseEvent) => void
  onHide: (e: React.MouseEvent) => void
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
        <div className="flex items-start gap-2 pr-14">
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
    <div className="rounded-lg bg-white dark:bg-gray-900/40 border border-gray-100 dark:border-transparent px-2 py-1.5">
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
