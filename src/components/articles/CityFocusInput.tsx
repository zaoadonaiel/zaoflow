'use client'

import { MapPin } from 'lucide-react'

export const CITY_FOCUS_OPTIONS = ['100', '50', '10'] as const
export type CityFocus = typeof CITY_FOCUS_OPTIONS[number]

const LABEL: Record<CityFocus, string> = {
  '100': '100% focus',
  '50': '50% focus',
  '10': '10% focus',
}
const HINT: Record<CityFocus, string> = {
  '100': 'City in the title and throughout the article',
  '50': 'City in the first heading, moderate mentions',
  '10': 'A couple of casual mentions in the body',
}

interface Props {
  city: string
  cityFocus: CityFocus | null
  onCityChange: (v: string) => void
  onFocusChange: (v: CityFocus | null) => void
  /** Colour scheme — matches the amber idea card versus the neutral article panel. */
  variant?: 'amber' | 'plain'
}

/**
 * A city input plus a "how prominent should the city be" three-way toggle.
 * Rendered in both the idea generator and the article generator so the same
 * city carries through the whole flow.
 *
 * The focus toggles only surface once a city has been typed — they steer a
 * city that is already there, so showing them empty just adds noise.
 */
export default function CityFocusInput({
  city, cityFocus, onCityChange, onFocusChange, variant = 'plain',
}: Props) {
  const inputBorder = variant === 'amber'
    ? 'border-amber-200 dark:border-amber-900/40'
    : 'border-gray-200 dark:border-gray-600'
  const ring = variant === 'amber' ? 'focus:ring-amber-400' : 'focus:ring-brand-500'

  return (
    <div className="space-y-1.5 mb-2">
      <label htmlFor={`city-${variant}`} className="sr-only">City name</label>
      <div className="relative">
        <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        <input
          id={`city-${variant}`}
          type="text"
          value={city}
          onChange={(e) => onCityChange(e.target.value)}
          placeholder="Optional — anchor the article to a city (e.g. Miami)"
          className={`w-full pl-8 pr-3 py-2 rounded-lg border bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 ${ring} ${inputBorder}`}
        />
      </div>
      {city.trim() && (
        <div className="flex flex-wrap gap-1.5">
          {CITY_FOCUS_OPTIONS.map((f) => {
            const active = cityFocus === f
            return (
              <button
                key={f}
                type="button"
                onClick={() => onFocusChange(active ? null : f)}
                aria-pressed={active}
                title={HINT[f]}
                className={`px-2.5 py-1 rounded-full border text-[11px] font-medium transition-colors ${
                  active
                    ? 'bg-brand-600 border-brand-600 text-white'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500'
                }`}
              >
                {LABEL[f]}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
