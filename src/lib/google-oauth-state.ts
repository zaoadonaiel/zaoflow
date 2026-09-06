import { createHmac, randomUUID, timingSafeEqual } from 'crypto'

/**
 * CSRF-safe OAuth state.
 *
 * The `state` parameter that goes to Google is meaningless on its own — Google
 * simply echoes it back. Its only job is to prove that the callback belongs to
 * a flow we started. So we sign it with a server secret and store the signature
 * in an httpOnly cookie on the outgoing redirect; on the way back we compare
 * the returned state against the cookie in constant time. A callback with a
 * different (or missing) cookie can't have come from a redirect we issued.
 */

/** How long the pending flow may take before the cookie is discarded. */
export const GOOGLE_OAUTH_STATE_TTL_S = 10 * 60

export const GOOGLE_OAUTH_STATE_COOKIE = 'google_oauth_state'

function secret(): string {
  const key = process.env.PORTAL_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('No signing secret configured for OAuth state')
  return key
}

function signState(state: string): string {
  return createHmac('sha256', secret()).update(state).digest('hex')
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Mint a fresh state and the value to store in the cookie for verification. */
export function issueOAuthState(): { state: string; cookieValue: string } {
  const state = randomUUID()
  return { state, cookieValue: signState(state) }
}

/**
 * True when `state` returned from Google matches the signature we cookied on
 * the outbound redirect. Missing cookie, empty state, or mismatched signature
 * all fail.
 */
export function verifyOAuthState(state: string | null, cookieValue: string | null): boolean {
  if (!state || !cookieValue) return false
  return safeEqual(cookieValue, signState(state))
}
