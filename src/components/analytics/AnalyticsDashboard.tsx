'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { BarChart3, Loader2, LogOut, Settings2, AlertCircle, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import type { Site } from '@/types'
import ConnectAnalyticsModal from '@/components/sites/ConnectAnalyticsModal'
import AddAnalyticsSiteModal from '@/components/sites/AddAnalyticsSiteModal'
import SummaryCards from './SummaryCards'
import CountriesTable from './CountriesTable'
import TopPagesTable from './TopPagesTable'
import KeywordsTable from './KeywordsTable'
import TrackingSnippet from './TrackingSnippet'

// recharts (plus its d3 dependencies) is by far the heaviest thing this page
// pulls in — loading it eagerly nearly doubled /analytics' First Load JS
// even before a site is connected and there's anything to chart. Split it
// into its own chunk, fetched only once there's real data to draw.
const TrendChart = dynamic(() => import('./TrendChart'), {
  ssr: false,
  loading: () => <div className="h-64 animate-pulse bg-gray-50 dark:bg-gray-800 rounded-2xl" />,
})

interface AnalyticsDashboardProps {
  sites: Site[]
  googleConnected: boolean
  googleEmail?: string
}

interface StatsResponse {
  summary: { sessions: number; users: number; pageviews: number; engagementRate: number }
  trend: Array<{ date: string; sessions: number; users: number }>
  topPages: Array<{ path: string; views: number }>
  countries: Array<{ country: string; sessions: number }>
  keywords: Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>
  measurementId: string | null
}

const RANGE_PRESETS = [
  { label: '7 days', days: 7 },
  { label: '28 days', days: 28 },
  { label: '90 days', days: 90 },
]

export default function AnalyticsDashboard({ sites, googleConnected, googleEmail }: AnalyticsDashboardProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [selectedSiteId, setSelectedSiteId] = useState(sites[0]?.id || '')
  const [rangeDays, setRangeDays] = useState(28)
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [loadingStats, setLoadingStats] = useState(false)
  const [statsError, setStatsError] = useState('')
  const [connectModalOpen, setConnectModalOpen] = useState(false)
  const [addSiteModalOpen, setAddSiteModalOpen] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const selectedSite = useMemo(
    () => sites.find((s) => s.id === selectedSiteId) || null,
    [sites, selectedSiteId]
  )

  useEffect(() => {
    const googleError = searchParams.get('google_error')
    const googleConnectedParam = searchParams.get('google_connected')

    if (googleError === 'rejected') toast.error('Google authorization was cancelled')
    else if (googleError === 'no_refresh_token')
      toast.error('Google did not grant offline access — try reconnecting')
    else if (googleError) toast.error('Failed to connect Google account')
    else if (googleConnectedParam) toast.success('Google account connected')

    if (googleError || googleConnectedParam) {
      router.replace('/analytics')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedSite || !selectedSite.ga4_property_id) {
      setStats(null)
      return
    }

    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - rangeDays)

    const params = new URLSearchParams({
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate.toISOString().slice(0, 10),
    })

    setLoadingStats(true)
    setStatsError('')

    fetch(`/api/analytics/${selectedSite.id}/stats?${params.toString()}`)
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) {
          setStatsError(data.error || 'Failed to load analytics')
          setStats(null)
          return
        }
        setStats(data)
      })
      .catch(() => setStatsError('Network error — please try again'))
      .finally(() => setLoadingStats(false))
  }, [selectedSite, rangeDays])

  async function handleDisconnect() {
    setDisconnecting(true)
    try {
      const res = await fetch('/api/google/disconnect', { method: 'POST' })
      if (!res.ok) {
        toast.error('Failed to disconnect Google account')
        return
      }
      toast.success('Google account disconnected')
      router.refresh()
    } catch {
      toast.error('Network error — please try again')
    } finally {
      setDisconnecting(false)
    }
  }

  function handleSaved() {
    router.refresh()
  }

  function handleSiteAdded() {
    setAddSiteModalOpen(false)
    router.refresh()
  }

  if (!googleConnected) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 p-10 flex flex-col items-center text-center gap-4">
        <div className="w-14 h-14 bg-brand-50 dark:bg-brand-500/10 rounded-2xl flex items-center justify-center">
          <BarChart3 className="w-7 h-7 text-brand-600" />
        </div>
        <div>
          <p className="font-semibold text-gray-900 dark:text-white text-lg">Connect your Google account</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1.5 max-w-md">
            Link Google Analytics and Search Console to see real traffic and keyword data for your
            sites, right here — no need to visit analytics.google.com.
          </p>
        </div>
        <a
          href="/api/google/connect"
          className="mt-2 flex items-center gap-2 bg-brand-600 text-white px-6 py-3 rounded-xl text-sm font-semibold hover:bg-brand-700 transition-colors shadow-sm"
        >
          <BarChart3 className="w-4 h-4" />
          Connect Google Account
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-green-50 dark:bg-green-500/10 rounded-lg flex items-center justify-center">
            <BarChart3 className="w-4 h-4 text-green-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              Connected{googleEmail ? ` as ${googleEmail}` : ''}
            </p>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-50"
            >
              <LogOut className="w-3 h-3" />
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {sites.length > 0 && (
            <select
              value={selectedSiteId}
              onChange={(e) => setSelectedSiteId(e.target.value)}
              className="px-3 py-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {!s.ga4_property_id ? ' (not connected)' : ''}
                </option>
              ))}
            </select>
          )}

          {selectedSite?.ga4_property_id && (
            <div className="flex items-center bg-gray-50 dark:bg-gray-800 rounded-xl p-1">
              {RANGE_PRESETS.map((preset) => (
                <button
                  key={preset.days}
                  onClick={() => setRangeDays(preset.days)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    rangeDays === preset.days
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}

          {selectedSite && (
            <button
              onClick={() => setConnectModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-xl text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <Settings2 className="w-3.5 h-3.5" />
              {selectedSite.ga4_property_id ? 'Edit connection' : 'Connect this site'}
            </button>
          )}

          <button
            onClick={() => setAddSiteModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-brand-600 text-white rounded-xl text-xs font-medium hover:bg-brand-700 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Site
          </button>
        </div>
      </div>

      {sites.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-10 flex flex-col items-center text-center gap-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">Add a site first, then connect it to Google Analytics.</p>
          <button
            onClick={() => setAddSiteModalOpen(true)}
            className="flex items-center gap-2 bg-brand-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Site
          </button>
        </div>
      ) : !selectedSite?.ga4_property_id ? (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 p-10 flex flex-col items-center text-center gap-4">
          <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
            <BarChart3 className="w-6 h-6 text-gray-400" />
          </div>
          <div>
            <p className="font-medium text-gray-900 dark:text-white">
              {selectedSite?.name} isn&apos;t connected to Google Analytics yet
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Map this site to a GA4 property to see its traffic data.
            </p>
          </div>
          <button
            onClick={() => setConnectModalOpen(true)}
            className="flex items-center gap-2 bg-brand-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            Connect this site to Google Analytics
          </button>
        </div>
      ) : loadingStats ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <Loader2 className="w-6 h-6 text-brand-600 animate-spin" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading analytics...</p>
        </div>
      ) : statsError ? (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-10 flex flex-col items-center text-center gap-3">
          <AlertCircle className="w-6 h-6 text-red-500" />
          <p className="text-sm text-gray-600 dark:text-gray-300">{statsError}</p>
        </div>
      ) : stats ? (
        <div className="space-y-6">
          <SummaryCards summary={stats.summary} />
          <TrendChart trend={stats.trend} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <TopPagesTable topPages={stats.topPages} />
            <CountriesTable countries={stats.countries} />
          </div>
          <KeywordsTable keywords={stats.keywords} gscConnected={!!selectedSite.gsc_site_url} />
          <TrackingSnippet
            measurementId={stats.measurementId}
            onConnectClick={() => setConnectModalOpen(true)}
          />
        </div>
      ) : null}

      <ConnectAnalyticsModal
        open={connectModalOpen}
        site={selectedSite}
        onClose={() => setConnectModalOpen(false)}
        onSaved={handleSaved}
      />

      <AddAnalyticsSiteModal
        open={addSiteModalOpen}
        onClose={() => setAddSiteModalOpen(false)}
        onDone={handleSiteAdded}
      />
    </div>
  )
}
