/**
 * Canonicalize the site URL that gets stored in `sites.url`. The DB has a
 * unique index on `(user_id, lower(regexp_replace(url, '/+$', '')))`, so this
 * function has to produce output that collides on the same site regardless of
 * casing or trailing slashes — otherwise the app would insert a "unique"
 * variant that the DB then rejects (or worse, silently accepts as a duplicate
 * on legacy rows).
 *
 * Intentionally *not* stripping `www.` — some sites are only reachable via
 * their apex host and others only via `www`, so folding them together would
 * merge distinct sites.
 *
 * Throws when the input can't be parsed as an http/https URL. Callers should
 * catch and return a 400.
 */
export function normalizeSiteUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('URL is required')

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  let parsed: URL
  try {
    parsed = new URL(withProtocol)
  } catch {
    throw new Error('Invalid URL')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('URL must use http or https')
  }

  const host = parsed.host.toLowerCase()
  const pathname = parsed.pathname.replace(/\/+$/, '')
  return `${parsed.protocol}//${host}${pathname}${parsed.search}${parsed.hash}`
}
