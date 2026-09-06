import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getGoogleAuthUrl } from '@/lib/google-analytics'
import {
  GOOGLE_OAUTH_STATE_COOKIE,
  GOOGLE_OAUTH_STATE_TTL_S,
  issueOAuthState,
} from '@/lib/google-oauth-state'

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // Sign the state and set the signature on an httpOnly cookie. The callback
  // only accepts a `state` whose signature matches the cookie, which closes
  // the CSRF hole a state-that-nothing-verifies leaves wide open.
  const { state, cookieValue } = issueOAuthState()
  const res = NextResponse.redirect(getGoogleAuthUrl(state))
  res.cookies.set({
    name: GOOGLE_OAUTH_STATE_COOKIE,
    value: cookieValue,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: GOOGLE_OAUTH_STATE_TTL_S,
  })
  return res
}
