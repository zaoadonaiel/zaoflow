import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { ACCESS_CODE_PATTERN, MAX_CODE_ATTEMPTS } from '@/lib/portal'
import { grantPortalSession } from '@/lib/portal-session'

function sameCode(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * The client entering the access code they were given.
 *
 * The code lives in the backend and is checked here, never sent to the browser
 * — which is the whole point of the change: the link is no longer enough on its
 * own, so a forwarded URL opens nothing without the code that went with it.
 *
 * A correct code sets a signed session cookie, which is what the rest of the
 * portal routes require, and counts as an open. A wrong one says only that it
 * was wrong and how many tries are left; the third shuts the link for good.
 * Five digits is 100,000 guesses, which is nothing to a script, so the way back
 * in is a new code from the dashboard rather than waiting out a timer.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const supabase = createServiceClient()
  const { code } = await req.json().catch(() => ({}))

  const { data: portal, error: portalError } = await supabase
    .from('client_portals')
    .select('id, user_id, is_active, access_code, failed_attempts')
    .eq('token', params.token)
    .single()

  if (portalError && portalError.code !== 'PGRST116') {
    // 42703 is "column does not exist" — migration 021 has not been run, so
    // there is no code to check against. Say which it is in the log rather
    // than leaving a portal that never opens and never explains itself.
    if (portalError.code === '42703') {
      console.error('[portal] access codes need migration 021_portal_access_code.sql:', portalError.message)
    } else {
      console.error('[portal] unlock lookup failed:', portalError)
    }
    return NextResponse.json({ error: 'This could not be checked. Please try again.' }, { status: 500 })
  }
  if (!portal || !portal.is_active) {
    return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })
  }

  // A portal from before the code column existed would have nothing to check
  // against, and letting a null match would hand the link back its old
  // free-for-all. Say it plainly instead.
  if (!portal.access_code) {
    console.error('[portal] portal has no access code:', portal.id)
    return NextResponse.json(
      { error: 'This link has no access code yet. Please contact your account manager.' },
      { status: 409 }
    )
  }

  const locked = 'Too many wrong codes. Ask your account manager for a new one.'

  if ((portal.failed_attempts || 0) >= MAX_CODE_ATTEMPTS) {
    return NextResponse.json({ error: locked, needs_new_code: true }, { status: 403 })
  }

  // Checked before the compare so a malformed entry cannot spend an attempt on
  // something that was never going to match anyway.
  if (typeof code !== 'string' || !ACCESS_CODE_PATTERN.test(code.trim())) {
    return NextResponse.json({ error: 'Enter the 5-digit code you were given.' }, { status: 400 })
  }

  if (!sameCode(code.trim(), portal.access_code)) {
    const attempts = (portal.failed_attempts || 0) + 1
    await supabase
      .from('client_portals')
      .update({ failed_attempts: attempts })
      .eq('id', portal.id)

    const left = MAX_CODE_ATTEMPTS - attempts
    if (left <= 0) {
      return NextResponse.json({ error: locked, needs_new_code: true }, { status: 403 })
    }
    return NextResponse.json(
      { error: `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` },
      { status: 401 }
    )
  }

  const now = new Date().toISOString()

  // A clean slate on the way in, so a client who fumbled the code twice last
  // week does not start one miss from being locked out today.
  await supabase
    .from('client_portals')
    .update({ failed_attempts: 0, last_viewed_at: now })
    .eq('id', portal.id)

  // Counted here, where the code is accepted, so the tally still means "the
  // client got in" rather than "something fetched this URL".
  await supabase.from('portal_opens').insert({
    portal_id: portal.id,
    user_id: portal.user_id,
    opened_at: now,
  })

  return grantPortalSession(NextResponse.json({ opened_at: now }), params.token, portal.access_code)
}
