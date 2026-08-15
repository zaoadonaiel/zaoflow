import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { testWordPressConnection } from '@/lib/wordpress'

export async function POST(
  _req: NextRequest,
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

  const result = await testWordPressConnection({
    siteUrl: site.url,
    username: site.wp_username,
    appPassword: site.wp_app_password,
  })

  await supabase.from('sites').update({
    status: result.success ? 'connected' : 'error',
    last_sync: result.success ? new Date().toISOString() : site.last_sync,
    updated_at: new Date().toISOString(),
  }).eq('id', params.id)

  return NextResponse.json(result)
}
