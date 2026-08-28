import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getValidAccessToken, listGA4Properties, listSearchConsoleSites, listGA4Accounts } from '@/lib/google-analytics'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const accessToken = await getValidAccessToken(user.id, supabase)

    const [ga4Properties, gscSites, ga4Accounts] = await Promise.all([
      listGA4Properties(accessToken),
      listSearchConsoleSites(accessToken),
      listGA4Accounts(accessToken),
    ])

    return NextResponse.json({ ga4Properties, gscSites, ga4Accounts })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load Google properties'
    const reconnect = message === 'Google account not connected'

    return NextResponse.json({ error: message, reconnect }, { status: 400 })
  }
}
