import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exchangeCodeForTokens } from '@/lib/google-analytics'

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url)
  const appUrl = origin

  const code = searchParams.get('code')

  if (searchParams.get('error')) {
    return NextResponse.redirect(`${appUrl}/analytics?google_error=rejected`)
  }

  if (!code) {
    return NextResponse.redirect(`${appUrl}/analytics?google_error=invalid`)
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(`${appUrl}/login`)
  }

  try {
    const tokens = await exchangeCodeForTokens(code)
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
      return NextResponse.redirect(`${appUrl}/analytics?google_error=no_refresh_token`)
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
      // Non-critical — skip if it fails
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
      return NextResponse.redirect(`${appUrl}/analytics?google_error=save_failed`)
    }

    return NextResponse.redirect(`${appUrl}/analytics?google_connected=1`)
  } catch {
    return NextResponse.redirect(`${appUrl}/analytics?google_error=exchange_failed`)
  }
}
