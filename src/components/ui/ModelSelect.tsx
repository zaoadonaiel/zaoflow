'use client'

import { useState, useEffect, useMemo } from 'react'
import { Star, ChevronDown, ExternalLink, Pencil, X, RotateCcw } from 'lucide-react'
import { AVAILABLE_MODELS } from '@/lib/openrouter'
import Modal from '@/components/ui/Modal'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { loadCatalogue, type Catalogue, type ModelPricing } from '@/lib/model-catalogue'
import { loadKept, keepModel, forgetModel, loadHidden, hideBuiltIn, restoreHidden } from '@/lib/model-memory'

const FAVORITES_KEY = 'zaoflo_favorites_text'
export const LAST_MODEL_KEY = 'zaoflo_last_model_text'

const OPENROUTER_SEO_MODELS_URL =
  'https://openrouter.ai/models?categories=marketing/seo&order=most-popular'

const BUILT_IN_IDS = AVAILABLE_MODELS.map((m) => m.id)

interface Props {
  value: string
  onChange: (model: string) => void
  className?: string
  lastModelKey?: string
  /** 'tile' is the standalone card; 'compact' is a single row for tight layouts */
  variant?: 'tile' | 'compact'
  /**
   * Tile only: something to sit beside the two prices, given a third of the
   * row. The article page puts Generate with AI there — what the model costs
   * and the button that spends it belong in the same glance.
   */
  action?: React.ReactNode
}

interface ListedModel {
  id: string
  name: string
  badge: string
  /** Kept because it was used, rather than shipped with the app. */
  kept: boolean
}

const EMPTY_CATALOGUE: Catalogue = { pricing: {}, names: {}, available: new Set(), ok: false }

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
  const [kept, setKept] = useState<string[]>([])
  const [hidden, setHidden] = useState<string[]>([])
  const [catalogue, setCatalogue] = useState<Catalogue>(EMPTY_CATALOGUE)
  const [pricingLoading, setPricingLoading] = useState(true)
  const [customDraft, setCustomDraft] = useState('')
  const [pendingDelete, setPendingDelete] = useState<ListedModel | null>(null)

  const known = AVAILABLE_MODELS.find((m) => m.id === value)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(FAVORITES_KEY)
      if (stored) setFavorites(JSON.parse(stored))
    } catch {}
    setKept(loadKept('text'))
    setHidden(loadHidden('text'))
  }, [])

  // A model that was used is on the list from then on, however it got chosen —
  // pasted into the custom box here, or restored from the last-used key by a
  // page that mounted with it already selected.
  useEffect(() => {
    if (!value) return
    setKept(keepModel('text', value, BUILT_IN_IDS))
  }, [value])

  // The trigger shows a price now, so this can't wait for the modal to open.
  // Every kept model is priced too, or the list would show them all as unknown.
  useEffect(() => {
    let active = true
    const extra = [...kept, value].filter((id) => id && !BUILT_IN_IDS.includes(id))
    loadCatalogue(extra).then((c) => {
      if (!active) return
      setCatalogue(c)
      setPricingLoading(false)
    })
    return () => {
      active = false
    }
  }, [value, kept])

  // Seed the modal's custom field with the current custom model
  useEffect(() => {
    if (value && !BUILT_IN_IDS.includes(value)) setCustomDraft(value)
  }, [value])

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
    onChange(id)
    if (!BUILT_IN_IDS.includes(id)) {
      try {
        localStorage.setItem(lastModelKey, id)
      } catch {}
    }
    setOpen(false)
  }

  function applyCustom() {
    const id = customDraft.trim()
    if (id) selectModel(id)
  }

  /**
   * Deleting a kept model forgets it; deleting a built-in only hides it, since
   * the shortlist ships with the app and has to be restorable.
   *
   * The model currently in use is left selected either way — the list is a set
   * of shortcuts, and silently switching the model out from under a half-built
   * article would be a worse surprise than a shortcut going missing.
   */
  function confirmDelete() {
    const target = pendingDelete
    if (!target) return
    if (target.kept) setKept(forgetModel('text', target.id))
    else setHidden(hideBuiltIn('text', target.id))
    setPendingDelete(null)
  }

  const listed: ListedModel[] = useMemo(() => {
    const builtIns = AVAILABLE_MODELS
      .filter((m) => !hidden.includes(m.id))
      .map((m) => ({ ...m, kept: false }))
    const keptModels = kept.map((id) => ({
      id,
      name: catalogue.names[id] || id,
      badge: 'Kept',
      kept: true,
    }))
    return [...builtIns, ...keptModels]
  }, [hidden, kept, catalogue.names])

  const currentName = known?.name || catalogue.names[value] || value || 'Select a model'
  const currentPrice = catalogue.pricing[value]
  const isFavourite = favorites.includes(value)

  // A model missing from a catalogue that never loaded is unknown, not gone.
  function isUnavailable(id: string) {
    return catalogue.ok && !catalogue.available.has(id)
  }

  // The compact row shows two prices with no room to label them, so spell it
  // out on hover rather than leaving "$1.00 / $3.00" to be guessed at.
  const compactTitle = currentPrice
    ? `${currentName} — ${formatPerM(currentPrice.inputPerM)} input / ` +
      `${formatPerM(currentPrice.outputPerM)} output per million tokens`
    : currentName

  const favoriteModels = listed.filter((m) => favorites.includes(m.id))
  const otherModels = listed.filter((m) => !favorites.includes(m.id))

  const renderGrid = (models: ListedModel[]) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {models.map((m) => (
        <ModelCard
          key={m.id}
          model={m}
          price={catalogue.pricing[m.id]}
          priceLoading={pricingLoading}
          selected={value === m.id}
          unavailable={isUnavailable(m.id)}
          isFav={favorites.includes(m.id)}
          onSelect={() => selectModel(m.id)}
          onToggleFav={(e) => toggleFav(m.id, e)}
          onDelete={() => setPendingDelete(m)}
        />
      ))}
    </div>
  )

  return (
    <div className={className}>
      {variant === 'tile' ? (
        <div className="rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 p-3">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="w-full flex items-center gap-1.5 min-w-0 text-left rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {isFavourite && (
              <Star className="w-3 h-3 text-yellow-400 fill-yellow-400 shrink-0" />
            )}
            <span className="flex-1 text-sm font-medium text-gray-900 dark:text-gray-100 truncate hover:text-brand-600 dark:hover:text-brand-400 transition-colors">
              {currentName}
            </span>
            <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
          </button>
          <div className={`grid gap-2 mt-2.5 ${action ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <PriceCell label="Input" value={currentPrice?.inputPerM} loading={pricingLoading} />
            <PriceCell label="Output" value={currentPrice?.outputPerM} loading={pricingLoading} />
            {action}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={compactTitle}
          className="w-full flex items-center gap-3 px-3.5 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-500 text-left text-gray-900 dark:text-gray-100"
        >
          {isFavourite && <Star className="w-3 h-3 text-yellow-400 fill-yellow-400 shrink-0" />}
          <span className="flex-1 truncate font-medium">{currentName}</span>
          {currentPrice && (
            // Was gray-400 on gray-50 — technically present, practically
            // invisible. The prices are the reason to look at this row.
            <span className="shrink-0 text-xs font-mono text-gray-600 dark:text-gray-300">
              {formatPerM(currentPrice.inputPerM)}
              <span className="text-gray-300 dark:text-gray-500 mx-1.5">/</span>
              {formatPerM(currentPrice.outputPerM)}
            </span>
          )}
          <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
        </button>
      )}

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

          {hidden.length > 0 && (
            <button
              type="button"
              onClick={() => setHidden(restoreHidden('text'))}
              className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-brand-600 dark:hover:text-brand-400"
            >
              <RotateCcw className="w-3 h-3" />
              Restore {hidden.length} deleted built-in {hidden.length === 1 ? 'model' : 'models'}
            </button>
          )}

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
            <p className="text-[11px] text-gray-400">
              Anything you use is added to the list above and stays there.
            </p>
            <a
              href={OPENROUTER_SEO_MODELS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400 hover:underline"
            >
              <ExternalLink className="w-3 h-3" />
              Browse top SEO models on OpenRouter
            </a>
          </div>
        </div>
      </Modal>

      {/* A sibling of the picker rather than a child of it: the picker's own
          dialog scrolls its content, and a confirm nested inside would scroll
          away with it. */}
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete AI model"
        message={
          <>
            Are you sure you want to delete this AI model?
            <span className="block mt-2 font-mono text-xs text-gray-500 dark:text-gray-400">
              {pendingDelete?.id}
            </span>
            <span className="block mt-2 text-xs text-gray-400">
              {pendingDelete?.kept
                ? 'It comes off your list. You can add it again from the custom box.'
                : 'It comes off your list, and can be restored from the picker.'}
            </span>
          </>
        }
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

function ModelCard({
  model,
  price,
  priceLoading,
  isFav,
  selected,
  unavailable,
  onSelect,
  onToggleFav,
  onDelete,
}: {
  model: ListedModel
  price?: ModelPricing
  priceLoading: boolean
  isFav: boolean
  selected: boolean
  unavailable: boolean
  onSelect: () => void
  onToggleFav: (e: React.MouseEvent) => void
  onDelete: () => void
}) {
  // The star and the X sit beside the card button rather than inside it — a
  // button nested in a button is invalid HTML and breaks hydration.
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onSelect}
        disabled={unavailable}
        title={unavailable ? 'OpenRouter is not listing this model right now' : undefined}
        className={`w-full text-left rounded-xl border p-3 transition-colors ${
          unavailable
            ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 opacity-60 cursor-not-allowed'
            : selected
            ? 'border-brand-400 dark:border-brand-700 bg-brand-50 dark:bg-brand-900/20'
            : 'border-gray-200 dark:border-gray-700 hover:border-brand-300 dark:hover:border-brand-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'
        }`}
      >
        <div className="flex items-start gap-2 pr-14">
          <span
            className={`text-sm font-medium truncate ${
              unavailable
                ? 'text-gray-400 dark:text-gray-500'
                : selected
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

        {/* Kept models are named by their catalogue name once it is known, so
            show the id too — it is what gets sent to OpenRouter. */}
        {model.kept && model.name !== model.id && (
          <div className="text-[10px] font-mono text-gray-400 truncate pr-14">{model.id}</div>
        )}

        {unavailable ? (
          <div className="mt-2.5 text-[11px] text-gray-400">
            Unavailable on OpenRouter right now
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 mt-2.5">
            <PriceCell label="Input" value={price?.inputPerM} loading={priceLoading} />
            <PriceCell label="Output" value={price?.outputPerM} loading={priceLoading} />
          </div>
        )}
      </button>

      <div className="absolute top-2 right-2 flex items-center gap-0.5">
        <button
          type="button"
          onClick={onToggleFav}
          aria-label={isFav ? `Remove ${model.name} from favorites` : `Add ${model.name} to favorites`}
          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
        >
          <Star
            className={`w-4 h-4 transition-colors ${
              isFav ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300 dark:text-gray-600 hover:text-yellow-400'
            }`}
          />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          aria-label={`Delete ${model.name}`}
          title="Delete this model"
          className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
        >
          <X className="w-4 h-4 text-gray-300 dark:text-gray-600 hover:text-red-500 transition-colors" />
        </button>
      </div>
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
