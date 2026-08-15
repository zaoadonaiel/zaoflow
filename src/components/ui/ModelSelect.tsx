'use client'

import { useState, useEffect, useRef } from 'react'
import { Star, ChevronDown, ExternalLink } from 'lucide-react'
import { AVAILABLE_MODELS } from '@/lib/openrouter'

const FAVORITES_KEY = 'zaoflo_favorites_text'
export const LAST_MODEL_KEY = 'zaoflo_last_model_text'

interface Props {
  value: string
  onChange: (model: string) => void
  className?: string
  lastModelKey?: string
  selectClassName?: string
}

export default function ModelSelect({ value, onChange, className, lastModelKey = LAST_MODEL_KEY }: Props) {
  const [open, setOpen] = useState(false)
  const [favorites, setFavorites] = useState<string[]>([])
  const [customMode, setCustomMode] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

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
    if (id === '__custom__') {
      setCustomMode(true)
      onChange('')
    } else {
      setCustomMode(false)
      onChange(id)
      if (!AVAILABLE_MODELS.some((m) => m.id === id)) {
        try { localStorage.setItem(lastModelKey, id) } catch {}
      }
    }
    setOpen(false)
  }

  const currentName = isKnown
    ? AVAILABLE_MODELS.find((m) => m.id === value)?.name
    : customMode
    ? value || 'Custom model…'
    : 'Select model…'

  const favoriteModels = AVAILABLE_MODELS.filter((m) => favorites.includes(m.id))

  return (
    <div className={`relative ${className ?? ''}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-500 text-left text-gray-900 dark:text-gray-100"
      >
        <span className="flex items-center gap-1.5 min-w-0">
          {favorites.includes(value) && (
            <Star className="w-3 h-3 text-yellow-400 fill-yellow-400 shrink-0" />
          )}
          <span className="truncate">{currentName}</span>
        </span>
        <ChevronDown
          className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
          {favoriteModels.length > 0 && (
            <>
              <p className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-gray-900/50">
                Favorites
              </p>
              {favoriteModels.map((m) => (
                <ModelRow
                  key={m.id}
                  model={m}
                  isFav
                  selected={value === m.id}
                  onSelect={() => selectModel(m.id)}
                  onToggleFav={(e) => toggleFav(m.id, e)}
                />
              ))}
              <div className="h-px bg-gray-100 dark:bg-gray-700" />
            </>
          )}

          <div className="max-h-56 overflow-y-auto py-1">
            {AVAILABLE_MODELS.map((m) => (
              <ModelRow
                key={m.id}
                model={m}
                isFav={favorites.includes(m.id)}
                selected={value === m.id}
                onSelect={() => selectModel(m.id)}
                onToggleFav={(e) => toggleFav(m.id, e)}
              />
            ))}
          </div>

          <div className="border-t border-gray-100 dark:border-gray-700">
            <button
              type="button"
              onClick={() => selectModel('__custom__')}
              className="w-full text-left px-3 py-2.5 text-sm text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-900/20 font-medium"
            >
              Custom model…
            </button>
          </div>
        </div>
      )}

      {customMode && (
        <div className="mt-2 space-y-1.5">
          <input
            type="text"
            value={value}
            onChange={(e) => {
              onChange(e.target.value)
              try { localStorage.setItem(lastModelKey, e.target.value) } catch {}
            }}
            placeholder="e.g. anthropic/claude-opus-4"
            className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
          />
          <a
            href="https://openrouter.ai/models?output_modalities=text"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400 hover:underline"
          >
            <ExternalLink className="w-3 h-3" />
            Browse all OpenRouter text models
          </a>
        </div>
      )}
    </div>
  )
}

function ModelRow({
  model,
  isFav,
  selected,
  onSelect,
  onToggleFav,
}: {
  model: { id: string; name: string; badge: string }
  isFav: boolean
  selected: boolean
  onSelect: () => void
  onToggleFav: (e: React.MouseEvent) => void
}) {
  return (
    <div
      onClick={onSelect}
      className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
        selected ? 'bg-brand-50 dark:bg-brand-900/20' : ''
      }`}
    >
      <button
        type="button"
        onClick={onToggleFav}
        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault() }}
        className="shrink-0 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-600"
        title={isFav ? 'Remove from favorites' : 'Add to favorites'}
      >
        <Star
          className={`w-4 h-4 transition-colors ${
            isFav ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300 hover:text-yellow-400'
          }`}
        />
      </button>
      <span
        className={`flex-1 text-sm truncate ${
          selected ? 'text-brand-700 dark:text-brand-400 font-medium' : 'text-gray-700 dark:text-gray-300'
        }`}
      >
        {model.name}
      </span>
      {model.badge && (
        <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded font-medium">
          {model.badge}
        </span>
      )}
    </div>
  )
}
