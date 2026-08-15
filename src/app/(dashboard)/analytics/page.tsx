import { createClient } from '@/lib/supabase/server'
import { BarChart3, CheckCircle2, XCircle, Clock, ExternalLink } from 'lucide-react'
import Badge, { statusToBadgeVariant } from '@/components/ui/Badge'
import { format } from 'date-fns'

export const dynamic = 'force-dynamic'

export default async function AnalyticsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [
    { data: logs },
    { count: total },
    { count: success },
    { count: failed },
  ] = await Promise.all([
    supabase.from('publish_logs')
      .select('*, articles(title), sites(name)')
      .eq('user_id', user!.id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('publish_logs').select('*', { count: 'exact', head: true }).eq('user_id', user!.id),
    supabase.from('publish_logs').select('*', { count: 'exact', head: true }).eq('user_id', user!.id).eq('status', 'success'),
    supabase.from('publish_logs').select('*', { count: 'exact', head: true }).eq('user_id', user!.id).eq('status', 'failed'),
  ])

  const stats = [
    { label: 'Total Publishes', value: total ?? 0, icon: BarChart3, color: 'text-brand-600 bg-brand-50' },
    { label: 'Successful', value: success ?? 0, icon: CheckCircle2, color: 'text-green-600 bg-green-50' },
    { label: 'Failed', value: failed ?? 0, icon: XCircle, color: 'text-red-600 bg-red-50' },
    { label: 'Pending', value: (total ?? 0) - (success ?? 0) - (failed ?? 0), icon: Clock, color: 'text-amber-600 bg-amber-50' },
  ]

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <p className="text-sm text-gray-500 mt-1">Publishing history and performance</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-500">{label}</p>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
                <Icon className="w-4 h-4" />
              </div>
            </div>
            <p className="text-3xl font-bold text-gray-900">{value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Publish Log</h2>
        </div>

        {!logs || logs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
              <BarChart3 className="w-6 h-6 text-gray-400" />
            </div>
            <p className="text-sm text-gray-500">No publish events yet</p>
          </div>
        ) : (
          <div>
            <div className="px-6 py-3 border-b border-gray-50">
              <div className="grid grid-cols-12 text-xs font-medium text-gray-400 uppercase tracking-wide gap-4">
                <div className="col-span-4">Article</div>
                <div className="col-span-2">Site</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-3">Date</div>
                <div className="col-span-1"></div>
              </div>
            </div>
            {logs.map((log) => (
              <div key={log.id} className="px-6 py-4 border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
                <div className="grid grid-cols-12 gap-4 items-center">
                  <div className="col-span-4">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <p className="text-sm font-medium text-gray-900 truncate">{(log as any).articles?.title || 'Unknown'}</p>
                    {log.error_message && (
                      <p className="text-xs text-red-500 mt-0.5 truncate">{log.error_message}</p>
                    )}
                  </div>
                  <div className="col-span-2">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <span className="text-sm text-gray-500">{(log as any).sites?.name || '—'}</span>
                  </div>
                  <div className="col-span-2">
                    <Badge variant={statusToBadgeVariant(log.status)}>{log.status}</Badge>
                  </div>
                  <div className="col-span-3">
                    <span className="text-xs text-gray-400">
                      {format(new Date(log.created_at), 'MMM d, yyyy h:mm a')}
                    </span>
                  </div>
                  <div className="col-span-1">
                    {log.wp_post_url && (
                      <a href={log.wp_post_url} target="_blank" rel="noopener noreferrer"
                        className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors inline-flex">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
