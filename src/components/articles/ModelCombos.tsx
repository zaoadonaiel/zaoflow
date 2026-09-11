'use client'

import { useEffect, useMemo, useState } from 'react'
import { Layers, Loader2, X, AlertTriangle, Save } from 'lucide-react'
import { loadPricing } from '@/components/ui/ModelSelect'
import ModelSelect from '@/components/ui/ModelSelect'
import ImageModelSelect from '@/components/ui/ImageModelSelect'
import Modal from '@/components/ui/Modal'
import { money } from '@/lib/format'
import toast from 'react-hot-toast'

export type ComboSlot = 'idea_model' | 'article_model' | 'seo_model' | 'image_model'

export interface ModelCombo {
  id: string
  name: string
  idea_model: string | null
  article_model: string | null
  seo_model: string | null
  image_model: string | null
  created_at: string
}

interface Props {
  /** The four models currently picked on the form — subject of "Save this combo". */
  currentModels: {
    idea: string
    article: string
    seo: string
    image: string
  }
  /** Applies a combo's four models to the form. */
  onLoad: (combo: ModelCombo) => void
  /** Total dollars of the most-recent generation for this article, shown as a
   *  hint on the save row so the user can see the price of what they're about
   *  to save. Null when no receipt yet. */
  lastGenerationCost?: number | null
}

const SLOT_LABEL: Record<ComboSlot, string> = {
  idea_model: 'Idea',
  article_model: 'Article',
  seo_model: 'SEO / Yoast',
  image_model: 'Image',
}

const IMAGE_SLOT: ComboSlot = 'image_model'

/**
 * Saved presets for the four AI models an article uses end to end.
 *
 * Sits under the cost receipt because the natural moment to save a combo is
 * right after seeing what one article cost. A combo whose model has since
 * been dropped by OpenRouter shows a greyed chip with a swap affordance,
 * rather than silently letting the next generation fail on that step.
 */
export default function ModelCombos({ currentModels, onLoad, lastGenerationCost = null }: Props) {
  const [combos, setCombos] = useState<ModelCombo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [discontinued, setDiscontinued] = useState<Set<string>>(new Set())
  const [swap, setSwap] = useState<{ combo: ModelCombo; slot: ComboSlot } | null>(null)

  useEffect(() => {
    fetch('/api/model-combos')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error)
        setCombos(d.combos || [])
        setError(null)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load combos'))
      .finally(() => setLoading(false))
  }, [])

  // Piggyback on the picker's shared pricing cache so we know which model ids
  // are no longer offered by OpenRouter. The first call fills the cache; every
  // subsequent mount returns instantly.
  useEffect(() => {
    loadPricing().then(({ discontinued: d }) => setDiscontinued(new Set(d)))
  }, [combos.length])

  const canSave =
    !!name.trim() &&
    !!(currentModels.idea || currentModels.article || currentModels.seo || currentModels.image)

  async function handleSave() {
    if (!canSave || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/model-combos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          idea_model: currentModels.idea || null,
          article_model: currentModels.article || null,
          seo_model: currentModels.seo || null,
          image_model: currentModels.image || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      setCombos((prev) => [data.combo, ...prev])
      setName('')
      toast.success(`Saved "${data.combo.name}"`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(combo: ModelCombo) {
    if (deletingId) return
    if (!confirm(`Delete combo "${combo.name}"?`)) return
    setDeletingId(combo.id)
    try {
      const res = await fetch(`/api/model-combos/${combo.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Delete failed')
      setCombos((prev) => prev.filter((c) => c.id !== combo.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleSwap(newModel: string) {
    if (!swap) return
    const { combo, slot } = swap
    try {
      const res = await fetch(`/api/model-combos/${combo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [slot]: newModel }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Swap failed')
      setCombos((prev) => prev.map((c) => (c.id === combo.id ? data.combo : c)))
      setSwap(null)
      toast.success(`${SLOT_LABEL[slot]} updated`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Swap failed')
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-3">
        <Layers className="w-4 h-4 text-gray-500" />
        Model combos
      </h3>

      {/* Save row — the current four picks, ready to name and stash. */}
      <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 p-3 mb-3">
        {lastGenerationCost !== null && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
            Last generation totalled <span className="font-semibold text-gray-700 dark:text-gray-200">{money(lastGenerationCost)}</span>.
            Save these models to reuse the same setup.
          </p>
        )}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 60))}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
            placeholder="Name this combo…"
            className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || saving}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
          >
            {saving
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving…</>
              : <><Save className="w-3.5 h-3.5" />Save</>}
          </button>
        </div>
        {!canSave && !!name.trim() && (
          <p className="mt-1 text-[11px] text-gray-400">
            Pick at least one model in the form above before saving.
          </p>
        )}
      </div>

      {/* Saved combos list — click a combo card to load it into the form. */}
      {loading ? (
        <div className="flex items-center justify-center py-6 text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50/60 dark:bg-red-900/10 p-3 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : combos.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-4">
          No combos yet. Save the current picks above to build your first preset.
        </p>
      ) : (
        <ul className="space-y-2">
          {combos.map((combo) => (
            <ComboRow
              key={combo.id}
              combo={combo}
              discontinued={discontinued}
              onLoad={() => onLoad(combo)}
              onDelete={() => handleDelete(combo)}
              onSwap={(slot) => setSwap({ combo, slot })}
              deleting={deletingId === combo.id}
            />
          ))}
        </ul>
      )}

      {/* Swap modal — different picker depending on whether the slot is text
          (idea/article/seo) or image. Loaded models replace the expired one
          via PATCH so the combo card updates in place. */}
      {swap && (
        <Modal
          open
          onClose={() => setSwap(null)}
          title={`Replace ${SLOT_LABEL[swap.slot]} model in "${swap.combo.name}"`}
          maxWidth="max-w-lg"
        >
          <div className="space-y-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              The saved model <span className="font-mono">{swap.combo[swap.slot]}</span> is no
              longer available on OpenRouter. Pick a replacement — the combo will keep
              its name and other slots.
            </p>
            {swap.slot === IMAGE_SLOT ? (
              <ImageModelSelect value="" onChange={handleSwap} />
            ) : (
              <ModelSelect value="" onChange={handleSwap} />
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}

interface ComboRowProps {
  combo: ModelCombo
  discontinued: Set<string>
  onLoad: () => void
  onDelete: () => void
  onSwap: (slot: ComboSlot) => void
  deleting: boolean
}

function ComboRow({ combo, discontinued, onLoad, onDelete, onSwap, deleting }: ComboRowProps) {
  const slots: ComboSlot[] = ['idea_model', 'article_model', 'seo_model', 'image_model']

  // Any expired model in the combo blocks a straight load — the user has to
  // substitute first, otherwise the next generation will fail on that step.
  const hasExpired = useMemo(
    () => slots.some((s) => !!combo[s] && discontinued.has(combo[s]!)),
    [combo, discontinued],
  )

  return (
    <li className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30 p-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <button
          type="button"
          onClick={onLoad}
          disabled={hasExpired}
          className="text-sm font-semibold text-gray-900 dark:text-white text-left truncate hover:text-brand-600 dark:hover:text-brand-400 transition-colors disabled:hover:text-gray-900 dark:disabled:hover:text-white disabled:cursor-not-allowed"
          title={hasExpired ? 'Replace the expired model(s) below before loading' : 'Load this combo into the form'}
        >
          {combo.name}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="flex-shrink-0 p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
          title="Delete combo"
        >
          {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
        </button>
      </div>

      <dl className="grid grid-cols-[auto,1fr] gap-x-2 gap-y-1 text-[11px] leading-relaxed">
        {slots.map((slot) => {
          const value = combo[slot]
          const isExpired = !!value && discontinued.has(value)
          return (
            <div key={slot} className="contents">
              <dt className="text-gray-400">{SLOT_LABEL[slot]}</dt>
              <dd className={`min-w-0 flex items-center gap-1.5 ${isExpired ? 'text-gray-400' : 'text-gray-600 dark:text-gray-300'}`}>
                {value ? (
                  <>
                    <span className={`font-mono truncate ${isExpired ? 'line-through' : ''}`} title={value}>
                      {value}
                    </span>
                    {isExpired && (
                      <button
                        type="button"
                        onClick={() => onSwap(slot)}
                        className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60 transition-colors"
                      >
                        <AlertTriangle className="w-2.5 h-2.5" />
                        Expired — choose another
                      </button>
                    )}
                  </>
                ) : (
                  <span className="text-gray-400 italic">not set</span>
                )}
              </dd>
            </div>
          )
        })}
      </dl>

      {!hasExpired && (
        <button
          type="button"
          onClick={onLoad}
          className="mt-2 w-full py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 hover:border-brand-300 dark:hover:border-brand-700 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
        >
          Load into form
        </button>
      )}
    </li>
  )
}
