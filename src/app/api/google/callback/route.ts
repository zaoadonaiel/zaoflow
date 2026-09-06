import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exchangeCodeForTokens } from '@/lib/google-analytics'
import {
  GOOGLE_OAUTH_STATE_COOKIE,
  verifyOAuthState,
} from '@/lib/google-oauth-state'

/**
 * Redirect back to the analytics dashboard with an error code, and clear the
 * short-lived state cookie so a retry starts clean.
 *
 * `detail` is the actual message from Google (or from us), URL-encoded so the
 * dashboard can render it verbatim instead of collapsing every failure into
 * one opaque toast.
 */
function fail(appUrl: string, code: string, detail?: string): NextResponse {
  const params = new URLSearchParams({ google_error: code })
  if (detail) params.set('google_error_detail', detail)
  const res = NextResponse.redirect(`${appUrl}/analytics?${params.toString()}`)
  res.cookies.delete(GOOGLE_OAUTH_STATE_COOKIE)
  return res
}

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url)
  const appUrl = origin

  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const cookieState = req.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value ?? null

  if (searchParams.get('error')) {
    return fail(appUrl, 'rejected', searchParams.get('error_description') || undefined)
  }

  if (!code) {
    return fail(appUrl, 'invalid')
  }

  // Verify the returned state matches the signature cookie we set on connect.
  // A missing cookie means the flow was never started here (or the cookie
  // aged out past its 10-minute TTL) — either way, treat it as unsigned.
  if (!verifyOAuthState(state, cookieState)) {
    return fail(appUrl, 'state_mismatch')
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    // Session cookie was missing when Google redirected back — previously we
    // sent them to /login with no explanation, which read as the whole thing
    // being broken. Land on the dashboard with a specific code so the toast
    // can say "please log in and try again."
    return fail(appUrl, 'not_logged_in')
  }

  let tokens
  try {
    tokens = await exchangeCodeForTokens(code)
  } catch (err) {
    return fail(appUrl, 'exchange_failed', err instanceof Error ? err.message : undefined)
  }

  try {
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    // Fetch existing connection so we don't null out a previously-stored
    // refresh_token if Google doesn't re-issue one this time.
    const { data: existing } = await supabase
      .from('google_connections')
      .select('refresh_token')
      .eq('user_id', user.id)
      .single()

    const refreshToken = tokens.refresh_token || existing?.refresh_token

    if (!refreshToken) {
      return fail(appUrl, 'no_refresh_token')
    }

    let googleEmail: string | undefined
    try {
      const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })
      if (infoRes.ok) {
        const info = await infoRes.json()
        googleEmail = info.email
      }
    } catch {
      // Non-critical — skip if it fails.
    }

    const { error } = await supabase.from('google_connections').upsert(
      {
        user_id: user.id,
        access_token: tokens.access_token,
        refresh_token: refreshToken,
        expires_at: expiresAt,
        scope: tokens.scope,
        ...(googleEmail ? { google_email: googleEmail } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )

    if (error) {
      return fail(appUrl, 'save_failed', error.message)
    }

    const res = NextResponse.redirect(`${appUrl}/analytics?google_connected=1`)
    res.cookies.delete(GOOGLE_OAUTH_STATE_COOKIE)
    return res
  } catch (err) {
    return fail(appUrl, 'save_failed', err instanceof Error ? err.message : undefined)
  }
}
