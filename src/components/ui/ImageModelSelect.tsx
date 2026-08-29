'use client'

import { useState, useEffect, useMemo } from 'react'
import { Star, ChevronDown, ExternalLink, Loader2, Image as ImageIcon, X, RotateCcw } from 'lucide-react'
import Modal from './Modal'
import ConfirmDialog from './ConfirmDialog'
import { IMAGE_GEN_MODELS } from '@/lib/image-gen'
import { loadCatalogue, type Catalogue } from '@/lib/model-catalogue'
import { loadKept, keepModel, forgetModel, loadHidden, hideBuiltIn, restoreHidden } from '@/lib/model-memory'

const FAVORITES_KEY = 'zaoflo_favorites_image'
export const LAST_IMG_MODEL_KEY = 'zaoflo_last_model_image'

const BUILT_IN_IDS = IMAGE_GEN_MODELS.map((m) => m.id)

interface Props {
  value: string
  onChange: (model: string) => void
  className?: string
}

interface ListedModel {
  id: string
  name: string
  badge: string
  /** Kept because it was used, rather than shipped with the app. */
  kept: boolean
}

const EMPTY_CATALOGUE: Catalogue = { pricing: {}, names: {}, available: new Set(), ok: false }

function perM(value: number): string {
  if (!value) return '—'
  if (value < 0.01) return '<$0.01'
  return `$${value.toFixed(2)}`
}

function perImage(value: number): string {
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(3)}`
}

export default function ImageModelSelect({ value, onChange, className }: Props) {
  const [open, setOpen] = useState(false)
  const [favorites, setFavorites] = useState<string[]>([])
  const [kept, setKept] = useState<string[]>([])
  const [hidden, setHidden] = useState<string[]>([])
  const [customMode, setCustomMode] = useState(false)
  const [customDraft, setCustomDraft] = useState('')
  const [catalogue, setCatalogue] = useState<Catalogue>(EMPTY_CATALOGUE)
  const [loading, setLoading] = useState(true)
  const [pendingDelete, setPendingDelete] = useState<ListedModel | null>(null)

  const isKnown = BUILT_IN_IDS.includes(value)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(FAVORITES_KEY)
      if (stored) setFavorites(JSON.parse(stored))
    } catch {}
    setKept(loadKept('image'))
    setHidden(loadHidden('image'))
  }, [])

  useEffect(() => {
    setCustomMode(!BUILT_IN_IDS.includes(value) && !!value)
  }, [value])

  // Any image model that gets used joins the list and stays on it.
  useEffect(() => {
    if (!value) return
    setKept(keepModel('image', value, BUILT_IN_IDS))
  }, [value])

  // Prices are decoration — a failure leaves the picker fully usable.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const extra = [...kept, value].filter((id) => id && !BUILT_IN_IDS.includes(id))
    loadCatalogue(extra)
      .then((c) => { if (!cancelled) setCatalogue(c) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [value, kept])

  function saveFavorites(next: string[]) {
    setFavorites(next)
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(next)) } catch {}
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
    try { localStorage.setItem(LAST_IMG_MODEL_KEY, id) } catch {}
    setOpen(false)
  }

  /**
   * A kept model is forgotten outright; a built-in is only hidden, so the
   * shipped shortlist can always be put back. Either way the model in use
   * stays selected — the list is shortcuts, not the setting itself.
   */
  function confirmDelete() {
    const target = pendingDelete
    if (!target) return
    if (target.kept) setKept(forgetModel('image', target.id))
    else setHidden(hideBuiltIn('image', target.id))
    setPendingDelete(null)
  }

  // A model missing from a catalogue that never loaded is unknown, not gone.
  function isUnavailable(id: string) {
    return catalogue.ok && !catalogue.available.has(id)
  }

  const currentName = isKnown
    ? IMAGE_GEN_MODELS.find((m) => m.id === value)?.name
    : catalogue.names[value] || value || 'Select model…'

  // Favourites first, then the rest, without listing anything twice.
  const ordered: ListedModel[] = useMemo(() => {
    const builtIns = IMAGE_GEN_MODELS
      .filter((m) => !hidden.includes(m.id))
      .map((m) => ({ ...m, kept: false }))
    const keptModels = kept.map((id) => ({
      id,
      name: catalogue.names[id] || id,
      badge: 'Kept',
      kept: true,
    }))
    const all = [...builtIns, ...keptModels]
    return [
      ...all.filter((m) => favorites.includes(m.id)),
      ...all.filter((m) => !favorites.includes(m.id)),
    ]
  }, [hidden, kept, favorites, catalogue.names])

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs hover:bg-gray-100 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-500 text-left text-gray-900 dark:text-gray-100"
      >
        <span className="flex items-center gap-1.5 min-w-0">
          {favorites.includes(value) && (
            <Star className="w-3 h-3 text-yellow-400 fill-yellow-400 shrink-0" />
          )}
          <span className="truncate">{currentName}</span>
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Image model" maxWidth="max-w-2xl">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Prices are live from OpenRouter.
          </p>
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />}
        </div>

        <div className="hidden sm:grid grid-cols-12 gap-3 px-3 pb-2 text-[11px] font-medium text-gray-400 uppercase tracking-wide">
          <span className="col-span-5">Model</span>
          <span className="col-span-2 text-right">Input /M</span>
          <span className="col-span-2 text-right">Output /M</span>
          <span className="col-span-2 text-right">Per image</span>
          <span className="col-span-1" />
        </div>

        <div className="max-h-[24rem] overflow-y-auto rounded-xl border border-gray-100 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
          {ordered.map((m) => {
            const p = catalogue.pricing[m.id]
            const isSel = value === m.id
            const gone = isUnavailable(m.id)
            return (
              <button
                key={m.id}
                type="button"
                disabled={gone}
                onClick={() => selectModel(m.id)}
                title={gone ? 'OpenRouter is not listing this model right now' : undefined}
                className={`w-full text-left px-3 py-3 grid grid-cols-12 gap-3 items-center transition-colors ${
                  gone
                    ? 'opacity-50 cursor-not-allowed bg-gray-50 dark:bg-gray-900/30'
                    : isSel
                    ? 'bg-brand-50 dark:bg-brand-900/20'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'
                }`}
              >
                <span className="col-span-12 sm:col-span-5 min-w-0 flex items-center gap-2">
                  <span
                    onClick={(e) => toggleFav(m.id, e)}
                    className="shrink-0 cursor-pointer"
                    role="button"
                    aria-label={favorites.includes(m.id) ? 'Remove favourite' : 'Add favourite'}
                  >
                    <Star className={`w-3.5 h-3.5 ${
                      favorites.includes(m.id)
                        ? 'text-yellow-400 fill-yellow-400'
                        : 'text-gray-300 dark:text-gray-600 hover:text-yellow-400'
                    }`} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-900 dark:text-white truncate">
                      {m.name}
                      {m.badge && (
                        <span className="ml-2 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-[10px] font-semibold text-gray-500 dark:text-gray-300 align-middle">
                          {m.badge}
                        </span>
                      )}
                    </span>
                    <span className="block text-[11px] font-mono text-gray-400 truncate">
                      {gone ? 'Unavailable on OpenRouter right now' : m.id}
                    </span>
                  </span>
                </span>

                <span className="col-span-4 sm:col-span-2 text-left sm:text-right">
                  <span className="sm:hidden text-[10px] text-gray-400 block">Input /M</span>
                  <span className="text-xs font-mono text-gray-700 dark:text-gray-300">
                    {p ? perM(p.inputPerM) : '—'}
                  </span>
                </span>

                <span className="col-span-4 sm:col-span-2 text-left sm:text-right">
                  <span className="sm:hidden text-[10px] text-gray-400 block">Output /M</span>
                  <span className="text-xs font-mono text-gray-700 dark:text-gray-300">
                    {p ? perM(p.outputPerM) : '—'}
                  </span>
                </span>

                <span className="col-span-3 sm:col-span-2 text-left sm:text-right">
                  <span className="sm:hidden text-[10px] text-gray-400 block">Per image</span>
                  <span className="text-xs font-mono text-gray-900 dark:text-white font-medium">
                    {p?.imagePerImage ? perImage(p.imagePerImage) : '—'}
                  </span>
                </span>

                {/* Same place as the text picker: the X sits to the right of
                    everything, and deleting always asks first. */}
                <span className="col-span-1 flex justify-end">
                  <span
                    onClick={(e) => {
                      e.stopPropagation()
                      setPendingDelete(m)
                    }}
                    role="button"
                    aria-label={`Delete ${m.name}`}
                    title="Delete this model"
                    className="shrink-0 cursor-pointer p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30"
                  >
                    <X className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 hover:text-red-500" />
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex items-center justify-between gap-3 mt-2">
          <p className="text-[11px] text-gray-400">
            An em dash means OpenRouter publishes no rate for that field — most image
            models bill per image rather than per token.
          </p>
          {hidden.length > 0 && (
            <button
              type="button"
              onClick={() => setHidden(restoreHidden('image'))}
              className="shrink-0 inline-flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400 hover:text-brand-600 dark:hover:text-brand-400"
            >
              <RotateCcw className="w-3 h-3" />
              Restore {hidden.length} deleted
            </button>
          )}
        </div>

        {/* Custom model */}
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
            Or use any OpenRouter image model
          </label>
          <div className="flex gap-2">
            <input
              value={customDraft}
              onChange={(e) => setCustomDraft(e.target.value)}
              placeholder="provider/model-id"
              className="flex-1 h-10 px-3 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm font-mono text-gray-900 dark:text-white"
            />
            <button
              type="button"
              disabled={!customDraft.trim()}
              onClick={() => selectModel(customDraft.trim())}
              className="h-10 px-4 rounded-lg bg-brand-600 text-white text-sm font-medium disabled:opacity-40"
            >
              Use
            </button>
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5">
            Anything you use is added to the list above and stays there.
          </p>
          {customMode && value && (
            <p className="text-[11px] text-gray-400 mt-1.5 flex items-center gap-1">
              <ImageIcon className="w-3 h-3" /> Currently using <span className="font-mono">{value}</span>
            </p>
          )}
          <a
            href="https://openrouter.ai/models?modality=text-%3Eimage"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-brand-600 hover:underline mt-2"
          >
            Browse image models on OpenRouter <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </Modal>

      {/* A sibling of the picker's dialog, not a child of its scrolling body. */}
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
                ? 'It comes off your list. You can add it again from the box below.'
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
