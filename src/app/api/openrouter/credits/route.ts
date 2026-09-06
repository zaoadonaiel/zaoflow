import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Reads the signed-in user's OpenRouter balance so the sidebar can show it.
 *
 * `/credits` is account-level: `total_credits` is everything ever added to the
 * account, `total_usage` is everything ever spent across every key. The
 * remaining balance is the difference. `/auth/key` looks similar but reports a
 * per-key spending cap, which is null for the common uncapped case — so it
 * cannot answer "what's left in my account".
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
    const res = await fetch('https://openrouter.ai/api/v1/credits', {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      return NextResponse.json({ error: `OpenRouter: ${res.status}` }, { status: 502 })
    }
    const json = await res.json()
    const totalCredits = Number(json?.data?.total_credits) || 0
    const totalUsage = Number(json?.data?.total_usage) || 0
    const balance = totalCredits - totalUsage

    return NextResponse.json({ usage: totalUsage, limit: totalCredits, balance })
  } catch {
    return NextResponse.json({ error: 'OpenRouter unreachable' }, { status: 502 })
  }
}
