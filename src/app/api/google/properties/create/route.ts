import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  getValidAccessToken,
  createGA4Property,
  createGA4WebDataStream,
} from '@/lib/google-analytics'

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { siteId, accountId, displayName, websiteUrl } = body

  if (!siteId || !accountId || !displayName || !websiteUrl) {
    return NextResponse.json(
      { error: 'siteId, accountId, displayName, and websiteUrl are required' },
      { status: 400 }
    )
  }

  const { data: site } = await supabase
    .from('sites')
    .select('*')
    .eq('id', siteId)
    .eq('user_id', user.id)
    .single()

  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  try {
    const accessToken = await getValidAccessToken(user.id, supabase)

    const { propertyId } = await createGA4Property(accessToken, accountId, displayName)
    const { measurementId } = await createGA4WebDataStream(accessToken, propertyId, displayName, websiteUrl)

    const { data: updated, error } = await supabase
      .from('sites')
      .update({
        ga4_property_id: propertyId,
        ga4_measurement_id: measurementId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', siteId)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ site: updated, propertyId, measurementId }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create GA4 property'
    const reconnect = message === 'Google account not connected'
    return NextResponse.json({ error: message, reconnect }, { status: 400 })
  }
}
