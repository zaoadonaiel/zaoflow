import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getValidAccessToken, runGA4Report, runSearchConsoleQuery } from '@/lib/google-analytics'

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function GET(
  req: NextRequest,
  { params }: { params: { siteId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: site } = await supabase
    .from('sites')
    .select('*')
    .eq('id', params.siteId)
    .eq('user_id', user.id)
    .single()

  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  if (!site.ga4_property_id) {
    return NextResponse.json({ error: 'Site not connected to Google Analytics' }, { status: 400 })
  }

  const { searchParams } = new URL(req.url)
  const now = new Date()
  const defaultStart = new Date(now)
  defaultStart.setDate(defaultStart.getDate() - 28)

  const startDate = searchParams.get('startDate') || formatDate(defaultStart)
  const endDate = searchParams.get('endDate') || formatDate(now)

  try {
    const accessToken = await getValidAccessToken(user.id, supabase)

    const [ga4Report, keywords] = await Promise.all([
      runGA4Report(accessToken, site.ga4_property_id, startDate, endDate),
      site.gsc_site_url
        ? runSearchConsoleQuery(accessToken, site.gsc_site_url, startDate, endDate)
        : Promise.resolve([]),
    ])

    return NextResponse.json({
      ...ga4Report,
      keywords,
      measurementId: site.ga4_measurement_id ?? null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load analytics data'
    const reconnect = message === 'Google account not connected'

    return NextResponse.json({ error: message, reconnect }, { status: 400 })
  }
}
