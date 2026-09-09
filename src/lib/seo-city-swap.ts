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

/**
 * Build a case-insensitive regex that matches the human display form of a
 * city name — tolerant of non-breaking spaces and `&nbsp;` between words.
 * WP block editors serialise runs of whitespace as `&nbsp;` and U+00A0 in
 * headings pretty often; a plain `"Los Angeles"` regex misses those.
 */
function displayRegex(display: string): RegExp {
  const pattern = display
    .split(/\s+/)
    .filter(Boolean)
    .map(escapeRegex)
    .join('(?:\\s|&nbsp;|\\u00a0)+')
  return new RegExp(pattern, 'gi')
}

function replaceDisplay(input: string, src: City, tgt: City): string {
  if (!src.display || !input) return input
  return input.replace(displayRegex(src.display), tgt.display)
}

/** Longest form first so "los-angeles" never eats "los-angeles-ca" mid-replace. */
function swapAllForms(text: string, src: City, tgt: City): string {
  let out = replaceOne(text, src.slug, tgt.slug)
  if (src.displaySlug !== src.slug) {
    out = replaceOne(out, src.displaySlug, tgt.displaySlug)
  }
  out = replaceDisplay(out, src, tgt)
  return out
}

/** Plain-text fields — title, excerpt, meta description, focus keyphrase. */
export function replaceCityInText(text: string, src: City, tgt: City): string {
  return swapAllForms(text, src, tgt)
}

/**
 * HTML body swap.
 *
 * Three regions get different treatment:
 *
 * - Text between tags: swap every form (display, display-slug, state-qualified
 *   slug). This is the visible body content.
 * - Inside `<tag …>` attribute lists: never touched. Classes, image src URLs,
 *   data attributes, style attrs. Swapping those breaks the layout.
 * - Inside `<!-- … -->` HTML/WP block comments: swap the display form ONLY.
 *   Gutenberg stores block titles/captions/subtitles as JSON in comment
 *   attributes (`{"title":"Los Angeles"}`), and the theme renders from those
 *   at output — so the H2 on a cover hero can be stuck reading the old city
 *   even when the body text swapped correctly. Swapping only the display
 *   form here leaves URL-slug fields inside comment JSON alone (a cover
 *   block's `"url":"…/los-angeles-hero.jpg"` stays valid).
 */
export function replaceCityInHtml(html: string, src: City, tgt: City): string {
  // First pass: split on tags only. Even = non-tag content, odd = tags.
  const byTag = html.split(/(<[^>]+>)/g)
  return byTag
    .map((chunk, i) => {
      if (i % 2 === 1) return chunk // tag — leave alone
      return swapWithCommentAwareness(chunk, src, tgt)
    })
    .join('')
}

/** For a chunk that isn't inside a tag, do the full swap on plain text and a
 *  display-only swap inside block/HTML comments. */
function swapWithCommentAwareness(chunk: string, src: City, tgt: City): string {
  const byComment = chunk.split(/(<!--[\s\S]*?-->)/g)
  return byComment
    .map((piece, i) => {
      if (i % 2 === 1) return replaceDisplay(piece, src, tgt) // inside comment
      return swapAllForms(piece, src, tgt) // regular text
    })
    .join('')
}

/** URL slug — hyphens only, no spaces. Longest form first. */
export function replaceCityInSlug(slug: string, src: City, tgt: City): string {
  let out = replaceOne(slug, src.slug, tgt.slug)
  if (src.displaySlug !== src.slug) {
    out = replaceOne(out, src.displaySlug, tgt.displaySlug)
  }
  return out
}
