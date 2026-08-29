import { createClient } from '@/lib/supabase/server'
import AnalyticsDashboard from '@/components/analytics/AnalyticsDashboard'

export const dynamic = 'force-dynamic'

export default async function AnalyticsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: sites }, { data: connection }] = await Promise.all([
    supabase
      .from('sites')
      .select('*')
      .eq('user_id', user!.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('google_connections')
      .select('*')
      .eq('user_id', user!.id)
      .single(),
  ])

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Analytics</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Traffic, audience, and keyword performance across your sites.
        </p>
      </div>

      <AnalyticsDashboard
        sites={sites || []}
        googleConnected={!!connection}
        googleEmail={connection?.google_email}
      />
    </div>
  )
}
