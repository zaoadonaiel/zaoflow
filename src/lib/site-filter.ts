/**
 * Shared "which site am I looking at" handling for the site dropdowns.
 *
 * `all` is a sentinel, not an id: it means "every connected site", and the
 * article queries simply drop the site_id filter rather than passing it on to
 * Postgres, which would reject it as a malformed uuid.
 */
export const ALL_SITES = 'all'

/** Query-string fragment for /api/articles. Empty when All is selected. */
export function siteParam(siteId: string): string {
  return siteId && siteId !== ALL_SITES ? `&site_id=${encodeURIComponent(siteId)}` : ''
}
