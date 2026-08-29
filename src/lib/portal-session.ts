import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * The proof that a client typed the right access code.
 *
 * A signed, http-only cookie rather than a flag in sessionStorage: the code is
 * a real credential now, so what it buys has to be something the browser cannot
 * simply set for itself. The cookie carries an expiry and an HMAC over
 * (token, code, expiry), so it cannot be forged, extended, or moved to another
 * portal's link — and issuing a new code in the dashboard invalidates every
 * session opened with the old one on the spot, which is what makes "new code"
 * worth reaching for when one gets out.
 */

/** How long one accepted code stays good for. */
export const PORTAL_SESSION_TTL_MS = 4 * 60 * 60 * 1000

/**
 * Signing key. A dedicated secret if one is set, otherwise the service-role key
 * — which is already required for the portal to work at all and never leaves
 * the server. Rotating either one just sends every client back to the gate.
 */
function secret(): string {
  const key = process.env.PORTAL_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('No portal session secret configured')
  return key
}

/**
 * One cookie per portal link, named after a hash of the token so a client
 * holding two links keeps both, and so the cookie itself does not spell out
 * which portal it belongs to.
 */
export function portalCookieName(token: string): string {
  return `portal_s_${createHash('sha256').update(token).digest('hex').slice(0, 16)}`
}

function sign(token: string, code: string, expiresAt: number): string {
  return createHmac('sha256', secret()).update(`${token}.${code}.${expiresAt}`).digest('hex')
}

function sameSignature(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Writes the pass onto a response. The client never sees or edits it. */
export function grantPortalSession(res: NextResponse, token: string, code: string): NextResponse {
  const expiresAt = Date.now() + PORTAL_SESSION_TTL_MS
  res.cookies.set({
    name: portalCookieName(token),
    value: `${expiresAt}.${sign(token, code, expiresAt)}`,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(PORTAL_SESSION_TTL_MS / 1000),
  })
  return res
}

/**
 * True if this request already passed the gate for this link, checked against
 * the code the portal has *now*.
 *
 * The lookup is what lets a reissued code take effect immediately, and it is
 * the same single-row read the route was going to do anyway.
 */
export async function hasPortalSession(token: string): Promise<boolean> {
  const raw = cookies().get(portalCookieName(token))?.value
  if (!raw) return false

  const [expiresRaw, signature] = raw.split('.')
  const expiresAt = Number(expiresRaw)
  if (!Number.isFinite(expiresAt) || !signature) return false
  if (expiresAt <= Date.now()) return false

  const { data: portal } = await createServiceClient()
    .from('client_portals')
    .select('access_code')
    .eq('token', token)
    .single()

  if (!portal?.access_code) return false

  return sameSignature(signature, sign(token, portal.access_code, expiresAt))
}

/**
 * The guard every portal route runs first. Returns a response to send back when
 * the code has not been entered, or null to carry on.
 *
 * `code_required` is what the page keys off to show the gate, so a session that
 * quietly expired mid-read asks for the code again instead of reading as a
 * broken link. A token that matches nothing gets the same answer as one whose
 * code was never entered — the gate is not a place to find out which links are
 * real.
 */
export async function requirePortalSession(token: string): Promise<NextResponse | null> {
  if (await hasPortalSession(token)) return null
  return NextResponse.json(
    { error: 'Enter your access code to continue.', code_required: true },
    { status: 401 }
  )
}
