/**
 * Starred ("favourite") models, kept in localStorage.
 *
 * Each site can have its own list, stored under `<baseKey>:<siteId>`. A site
 * with no list of its own falls back to the global one, so stars set before
 * per-site lists existed keep working; the first star toggled inside a site
 * copies the effective list into that site's key and diverges from there.
 *
 * A list can also fall back to a legacy key (the shared list that predates
 * separate idea / article lists), so existing stars keep working.
 *
 * Client-only: every function reads localStorage and returns an empty result
 * when it is unavailable.
 */

function siteKey(baseKey: string, siteId?: string | null): string {
  return siteId ? `${baseKey}:${siteId}` : baseKey
}

function parseList(raw: string | null): string[] | null {
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : null
  } catch {
    return null
  }
}

/**
 * The effective favourites: the site's own list if it has one, else the global
 * list for this key, else the legacy key's list.
 */
export function readFavorites(baseKey: string, siteId?: string | null, legacyKey?: string): string[] {
  try {
    if (siteId) {
      const own = parseList(localStorage.getItem(siteKey(baseKey, siteId)))
      if (own) return own
    }
    const global = parseList(localStorage.getItem(baseKey))
    if (global) return global
    return legacyKey ? parseList(localStorage.getItem(legacyKey)) ?? [] : []
  } catch {
    return []
  }
}

/** Saves to the site's own list when a site is given, otherwise the global list. */
export function writeFavorites(baseKey: string, siteId: string | null | undefined, list: string[]): void {
  try { localStorage.setItem(siteKey(baseKey, siteId), JSON.stringify(list)) } catch {}
}

/** Earliest-starred favourite that is not hidden, or '' when there is none. */
export function firstFavorite(
  baseKey: string, hiddenKey: string, siteId?: string | null, legacyKey?: string,
): string {
  const hidden = (() => {
    try { return parseList(localStorage.getItem(hiddenKey)) ?? [] } catch { return [] }
  })()
  return readFavorites(baseKey, siteId, legacyKey).find((f) => !hidden.includes(f)) || ''
}
