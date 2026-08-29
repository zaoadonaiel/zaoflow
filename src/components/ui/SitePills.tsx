'use client'

import type { Site } from '@/types'
import { ALL_SITES } from '@/lib/site-filter'

/**
 * The site pills: grey until you pick one, then lit up.
 *
 * The neon differs by theme because neither colour survives both backgrounds —
 * neon green on white is barely legible, and neon purple on near-black loses
 * the glow that makes it read as "on". Both are outline and text only, so a
 * selected pill is brighter than its neighbours rather than a filled block.
 */
const PILL_IDLE =
  'border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700 ' +
  'dark:border-gray-600 dark:text-gray-400 dark:hover:border-gray-500 dark:hover:text-gray-200'

const PILL_ACTIVE =
  'border-[#b026ff] text-[#b026ff] shadow-[0_0_10px_-2px_#b026ff] ' +
  'dark:border-[#39ff14] dark:text-[#39ff14] dark:shadow-[0_0_10px_-2px_#39ff14]'

interface SitePillsProps {
  sites: Site[]
  value: string
  onChange: (siteId: string) => void
  /** Filters that are not sites — the image library's "No site", say. */
  extra?: { id: string; name: string }[]
  className?: string
}

export default function SitePills({ sites, value, onChange, extra = [], className = '' }: SitePillsProps) {
  if (!sites.length) return null

  const pills = [{ id: ALL_SITES, name: 'All sites' }, ...sites, ...extra]

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {pills.map((p) => {
        const selected = value === p.id
        return (
          <button
            key={p.id}
            // Clicking the site you are already on takes the filter off, so a
            // pill is never a one-way door back to the dropdown.
            onClick={() => onChange(selected ? ALL_SITES : p.id)}
            aria-pressed={selected}
            className={`px-4 py-1.5 rounded-full border bg-transparent text-sm font-medium transition-all ${
              selected ? PILL_ACTIVE : PILL_IDLE
            }`}
          >
            {p.name}
          </button>
        )
      })}
    </div>
  )
}
