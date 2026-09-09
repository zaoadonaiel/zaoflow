/**
 * City-name swap for the SEO Pages tool.
 *
 * The tool takes a source city page and produces a clone for a target city.
 * The point is to change visible text — headings, paragraphs, meta fields,
 * the URL slug — and nothing else. Class names, block comments, image URLs
 * and other markup have to survive verbatim, or the cloned page renders
 * broken. That last constraint is why `replaceCityInHtml` walks HTML tags
 * separately from text.
 */

export interface City {
  /** Human form for headings and body: "Los Angeles". */
  display: string
  /** Slug form without state: "los-angeles". */
  displaySlug: string
  /** State-qualified slug: "los-angeles-ca", or same as displaySlug when no state. */
  slug: string
  /** Two-letter state code, lowercase, or null when the input didn't include one. */
  state: string | null
}

/**
 * Parse "Los Angeles CA" into its parts.
 *
 * A trailing 2-letter token is treated as a state code, so the slug can keep
 * its "-ca" qualifier while the body text reads "Los Angeles" rather than
 * "Los Angeles CA" mid-sentence. When the target city has no state and
 * `fallbackState` is passed, the state inherits from the source — so typing
 * just "Oakland" produces the slug "oakland-ca" when the source was "-ca".
 */
export function parseCity(raw: string, fallbackState: string | null = null): City {
  const trimmed = raw.trim()
  if (!trimmed) return { display: '', displaySlug: '', slug: '', state: null }

  const words = trimmed.split(/\s+/)
  const last = words[words.length - 1]
  const hasState = words.length > 1 && /^[A-Za-z]{2}$/.test(last)

  const cityWords = hasState ? words.slice(0, -1) : words
  const state = hasState ? last.toLowerCase() : fallbackState

  const display = cityWords
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')

  const displaySlug = display
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')

  const slug = state ? `${displaySlug}-${state}` : displaySlug

  return { display, displaySlug, slug, state }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceOne(input: string, from: string, to: string): string {
  if (!from || !input) return input
  return input.replace(new RegExp(escapeRegex(from), 'gi'), to)
}

/** Longest form first so "los-angeles" never eats "los-angeles-ca" mid-replace. */
function swapAllForms(text: string, src: City, tgt: City): string {
  let out = replaceOne(text, src.slug, tgt.slug)
  if (src.displaySlug !== src.slug) {
    out = replaceOne(out, src.displaySlug, tgt.displaySlug)
  }
  out = replaceOne(out, src.display, tgt.display)
  return out
}

/** Plain-text fields — title, excerpt, meta description, focus keyphrase. */
export function replaceCityInText(text: string, src: City, tgt: City): string {
  return swapAllForms(text, src, tgt)
}

/**
 * HTML body swap.
 *
 * Split on tags and HTML/WP comments; the capture group keeps them in the
 * output. Even chunks are text (which we swap), odd chunks are tags or
 * comments (which we leave untouched). This is the point of the whole file:
 * a class name, an image URL, a Gutenberg block marker or a data attribute
 * that happens to contain the source city name will survive verbatim, so the
 * cloned page still renders.
 *
 * Trade-off: internal links whose href is city-specific (e.g. an on-page
 * "back to Los Angeles" link) won't retarget. Better a stale link than a
 * broken layout.
 */
export function replaceCityInHtml(html: string, src: City, tgt: City): string {
  const parts = html.split(/(<!--[\s\S]*?-->|<[^>]+>)/g)
  return parts.map((part, i) => (i % 2 === 1 ? part : swapAllForms(part, src, tgt))).join('')
}

/** URL slug — hyphens only, no spaces. Longest form first. */
export function replaceCityInSlug(slug: string, src: City, tgt: City): string {
  let out = replaceOne(slug, src.slug, tgt.slug)
  if (src.displaySlug !== src.slug) {
    out = replaceOne(out, src.displaySlug, tgt.displaySlug)
  }
  return out
}
