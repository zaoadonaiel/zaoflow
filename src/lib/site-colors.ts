import type { Site } from '@/types'

/**
 * A colour per site, for the calendars that show more than one at a time.
 *
 * On All sites a month is a wall of identical rows, and which article belongs
 * to whom is the first thing you want and the last thing the grid says. A
 * colour answers it without reading a word.
 *
 * Assigned by the site's position in the list the dashboard already shows, so
 * a site keeps its colour between pages and across reloads — a colour that
 * moved around would be worse than none.
 */
export interface SiteColor {
  name: string
  /** A filled dot or a bar down the side of a row. */
  bar: string
  dot: string
  /** Text and border for a small chip carrying the site's name. */
  chip: string
}

export const SITE_COLORS: SiteColor[] = [
  { name: 'Blue',   bar: 'bg-blue-500',    dot: 'bg-blue-500',    chip: 'text-blue-700 border-blue-300 dark:text-blue-300 dark:border-blue-700' },
  { name: 'Green',  bar: 'bg-green-500',   dot: 'bg-green-500',   chip: 'text-green-700 border-green-300 dark:text-green-300 dark:border-green-700' },
  { name: 'Yellow', bar: 'bg-amber-400',   dot: 'bg-amber-400',   chip: 'text-amber-700 border-amber-300 dark:text-amber-300 dark:border-amber-700' },
  { name: 'Purple', bar: 'bg-purple-500',  dot: 'bg-purple-500',  chip: 'text-purple-700 border-purple-300 dark:text-purple-300 dark:border-purple-700' },
  { name: 'Pink',   bar: 'bg-pink-500',    dot: 'bg-pink-500',    chip: 'text-pink-700 border-pink-300 dark:text-pink-300 dark:border-pink-700' },
  { name: 'Teal',   bar: 'bg-teal-500',    dot: 'bg-teal-500',    chip: 'text-teal-700 border-teal-300 dark:text-teal-300 dark:border-teal-700' },
  { name: 'Orange', bar: 'bg-orange-500',  dot: 'bg-orange-500',  chip: 'text-orange-700 border-orange-300 dark:text-orange-300 dark:border-orange-700' },
  { name: 'Indigo', bar: 'bg-indigo-500',  dot: 'bg-indigo-500',  chip: 'text-indigo-700 border-indigo-300 dark:text-indigo-300 dark:border-indigo-700' },
]

/**
 * site id -> colour, in the order the sites are listed.
 *
 * More sites than colours wraps round rather than running out; eight is well
 * past the point where a colour still tells them apart anyway.
 */
export function siteColors(sites: Pick<Site, 'id'>[]): Map<string, SiteColor> {
  return new Map(sites.map((s, i) => [s.id, SITE_COLORS[i % SITE_COLORS.length]]))
}
