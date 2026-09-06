import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Reads the signed-in user's OpenRouter balance so the sidebar can show it.
 *
 * OpenRouter's `/auth/key` endpoint returns a per-key usage + limit reading,
 * both denominated in USD credits. The balance is limit - usage; a null limit
 * means the key is uncapped, in which case we can only show usage.
 */
export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: settings } = await supabase
    .from('api_settings')
    .select('openrouter_api_key')
    .eq('user_id', user.id)
    .single()

  const key = settings?.openrouter_api_key
  if (!key) return NextResponse.json({ error: 'No OpenRouter key set' }, { status: 404 })

  try {
    const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      return NextResponse.json({ error: `OpenRouter: ${res.status}` }, { status: 502 })
    }
    const json = await res.json()
    const usage = Number(json?.data?.usage) || 0
    const limit = json?.data?.limit == null ? null : Number(json.data.limit)
    const balance = limit == null ? null : limit - usage

    return NextResponse.json({ usage, limit, balance })
  } catch {
    return NextResponse.json({ error: 'OpenRouter unreachable' }, { status: 502 })
  }
}
