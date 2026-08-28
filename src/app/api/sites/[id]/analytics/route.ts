import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getGA4MeasurementId, getValidAccessToken } from '@/lib/google-analytics'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: site } = await supabase
    .from('sites')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  const body = await req.json()
  const ga4PropertyId: string | null = body.ga4_property_id ?? null
  const gscSiteUrl: string | null = body.gsc_site_url ?? null

  let ga4MeasurementId: string | null = null

  if (ga4PropertyId) {
    try {
      const accessToken = await getValidAccessToken(user.id, supabase)
      ga4MeasurementId = await getGA4MeasurementId(accessToken, ga4PropertyId)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch GA4 measurement ID'
      return NextResponse.json({ error: message }, { status: 400 })
    }
  }

  const { data: updated, error } = await supabase
    .from('sites')
    .update({
      ga4_property_id: ga4PropertyId,
      ga4_measurement_id: ga4MeasurementId,
      gsc_site_url: gscSiteUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ site: updated })
}
