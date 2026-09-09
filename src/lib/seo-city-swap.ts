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

/**
 * Every single-character-deletion variant of the display form, minus the
 * original itself. Catches the most common typo class on source pages —
 * a missing letter, like "Los Angles" for "Los Angeles" or "Agora Hills"
 * for "Agoura Hills". Skipped when the variant would collapse a word
 * boundary (turning "Los Angeles" into "LosAngeles" is not a typo) or drop
 * below 5 characters (too short — a stray match against unrelated words).
 */
function deletionVariants(display: string): string[] {
  const out = new Set<string>()
  for (let i = 0; i < display.length; i++) {
    const v = display.slice(0, i) + display.slice(i + 1)
    if (v.length < 5) continue
    // A variant that removed a space glues two words together — that's a
    // formatting error the theme wouldn't produce, not a typo worth swapping.
    if (/\s{2,}/.test(v)) continue
    if (display[i] === ' ') continue
    if (v.toLowerCase() === display.toLowerCase()) continue
    out.add(v)
  }
  return [...out]
}

/** Case-insensitive plain replacement bounded by word edges, so a deletion
 *  variant like "Los Angles" doesn't stray into "los-angles" URL fragments
 *  or other unrelated contexts. */
function replaceWord(input: string, from: string, to: string): string {
  if (!from || !input) return input
  const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegex(from)}(?![A-Za-z0-9])`, 'gi')
  return input.replace(re, to)
}

/** Longest form first so "los-angeles" never eats "los-angeles-ca" mid-replace.
 *  Slug-form matches emit the TARGET DISPLAY form, not the target slug —
 *  because this runs on human-readable text (titles, headings, meta,
 *  visible body content). A source that happens to carry a slug-form
 *  reference ("yorba-linda-events" in a title, or the WP title falling
 *  back to `data.slug` when the source title is blank) would otherwise
 *  land the target's slug form ("el-modena-events") in a place a reader
 *  sees, instead of "El Modena events". URL slug fields go through
 *  `replaceCityInSlug` and keep hyphenation as intended. */
function swapAllForms(text: string, src: City, tgt: City): string {
  let out = replaceOne(text, src.slug, tgt.display)
  if (src.displaySlug !== src.slug) {
    out = replaceOne(out, src.displaySlug, tgt.display)
  }
  out = replaceDisplay(out, src, tgt)
  // Typo tolerance: catch single-missing-letter misspellings of the display
  // form ("Los Angles" for "Los Angeles"). Word-bounded so the shorter
  // variant can't leak into unrelated tokens.
  for (const variant of deletionVariants(src.display)) {
    out = replaceWord(out, variant, tgt.display)
  }
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
 * - Text between tags: match every form of the source (display, display-slug,
 *   state-qualified slug) but always emit the target's display form, since
 *   this is the visible body content and no reader should see "el-modena"
 *   where "El Modena" belongs.
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
  // Comments FIRST — `<[^>]+>` would otherwise swallow a whole `<!-- … -->`
  // as one "tag" (comments start with `<`, have no `>` in the body, and end
  // with `>`), so any tag-first split silently strips comments from the
  // comment-aware pass and leaves the block-attr JSON un-swapped.
  const byComment = html.split(/(<!--[\s\S]*?-->)/g)
  return byComment
    .map((piece, i) => {
      if (i % 2 === 1) return swapInsideComment(piece, src, tgt)
      return swapOutsideTags(piece, src, tgt)
    })
    .join('')
}

/** Inside a `<!-- … -->` chunk, swap the source city's display form (Gutenberg
 *  block titles like `{"title":"Los Angeles"}`) AND its slug form when the
 *  slug is an entire quoted value (`{"title":"los-angeles"}`), but never when
 *  the slug is embedded in a longer path — so `"url":"/img/los-angeles-hero.jpg"`
 *  stays intact. Keeping URL paths untouched matters because they point at
 *  real images/routes that don't get renamed when the city is normalised. */
function swapInsideComment(piece: string, src: City, tgt: City): string {
  let out = replaceDisplay(piece, src, tgt)
  const forms = [src.slug]
  if (src.displaySlug !== src.slug) forms.push(src.displaySlug)
  for (const form of forms) {
    if (!form) continue
    const quoted = new RegExp(`"${escapeRegex(form)}"`, 'gi')
    out = out.replace(quoted, `"${tgt.display}"`)
  }
  return out
}

/** For a chunk with no HTML comments, swap text nodes and leave `<tag …>`
 *  attribute lists alone (so classes, `src` URLs and style attributes
 *  survive). */
function swapOutsideTags(chunk: string, src: City, tgt: City): string {
  const byTag = chunk.split(/(<[^>]+>)/g)
  return byTag
    .map((part, i) => (i % 2 === 1 ? part : swapAllForms(part, src, tgt)))
    .join('')
}

/**
 * Force a target city name to its exact display form throughout an HTML body.
 *
 * The AI rewrite step tends to drift the target city's case ("San Francisco"
 * becomes "san francisco" mid-paragraph) or slug-ify it into visible text
 * ("san-francisco"), even when the prompt tells it not to. Runs the standard
 * tag-safe swap with the target on BOTH sides, so any case-insensitive
 * variant of the target — including its slug forms — collapses back to the
 * canonical display form. Attribute lists inside `<tag …>` stay untouched so
 * legitimate URLs like `href="/san-francisco-events/"` survive.
 */
export function enforceCityDisplayInHtml(html: string, city: City): string {
  if (!city.display || !html) return html
  return replaceCityInHtml(html, city, city)
}

/** Text-field counterpart to `enforceCityDisplayInHtml`, for plain-text
 *  values like the post title, Yoast title, meta description, focus keyphrase
 *  and keyphrase synonyms. */
export function enforceCityDisplayInText(text: string, city: City): string {
  if (!city.display || !text) return text
  return replaceCityInText(text, city, city)
}

/** URL slug — hyphens only, no spaces. Longest form first. */
export function replaceCityInSlug(slug: string, src: City, tgt: City): string {
  let out = replaceOne(slug, src.slug, tgt.slug)
  if (src.displaySlug !== src.slug) {
    out = replaceOne(out, src.displaySlug, tgt.displaySlug)
  }
  return out
}

/**
 * Generic tag-safe find/replace for the Find/Replace tool in the SEO Page
 * Builder. Text inside `<tag …>` attributes is left alone (so classes,
 * `src` URLs, style attributes survive); everything else (text nodes and
 * block-comment contents) gets the substitution. Case-insensitive.
 */
export function findReplaceInHtml(html: string, from: string, to: string): string {
  if (!from || !html) return html
  const re = new RegExp(escapeRegex(from), 'gi')
  const parts = html.split(/(<[^>]+>)/g)
  return parts.map((chunk, i) => (i % 2 === 1 ? chunk : chunk.replace(re, to))).join('')
}

/** Plain-text find/replace. Case-insensitive. Used for slugs, titles, meta. */
export function findReplaceInText(text: string, from: string, to: string): string {
  if (!from || !text) return text
  return text.replace(new RegExp(escapeRegex(from), 'gi'), to)
}
