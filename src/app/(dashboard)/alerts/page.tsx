'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  ExternalLink,
  ListChecks,
  Rocket,
  RefreshCw,
} from 'lucide-react'
import Header from '@/components/layout/Header'
import Badge from '@/components/ui/Badge'
import type { ContentAlert } from '@/lib/content-alerts'
import { formatShortDate } from '@/lib/content-alerts'

/**
 * Content Alerts — one entry per site whose scheduled-article queue is empty
 * or almost empty. The whole point is: know before a client site goes quiet.
 */
export default function AlertsPage() {
  const [alerts, setAlerts] = useState<ContentAlert[]>([])
  const [healthy, setHealthy] = useState<ContentAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showHealthy, setShowHealthy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/alerts', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load alerts')
      setAlerts(data.alerts || [])
      setHealthy(data.healthy || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load alerts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div>
      <Header
        title="Content Alerts"
        subtitle="Sites running low on scheduled articles — the ones that need attention first."
        actions={
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-xl text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      {loading ? (
        <div className="flex items-center gap-2 py-16 justify-center text-sm text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading alerts…
        </div>
      ) : error ? (
        <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400 py-6">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            {error}{' '}
            <button
              type="button"
              onClick={load}
              className="underline underline-offset-2 hover:text-red-700 dark:hover:text-red-300"
            >
              Retry
            </button>
          </span>
        </div>
      ) : (
        <>
          {alerts.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-10 flex flex-col items-center gap-3 text-center">
              <div className="w-14 h-14 rounded-2xl bg-green-50 dark:bg-green-900/30 flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">All caught up.</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Every site has at least {' '}
                  <span className="font-medium text-gray-700 dark:text-gray-300">5 days</span> of scheduled runway.
                </p>
              </div>
            </div>
          ) : (
            <ul className="space-y-3">
              {alerts.map((a) => <AlertCard key={a.site_id} alert={a} />)}
            </ul>
          )}

          {healthy.length > 0 && (
            <section className="mt-8">
              <button
                type="button"
                onClick={() => setShowHealthy((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                {showHealthy ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                All good ({healthy.length})
              </button>
              {showHealthy && (
                <ul className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {healthy.map((h) => (
                    <li
                      key={h.site_id}
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-900 dark:text-white truncate">{h.site_name}</p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                          {h.upcoming_count} queued · runs {h.last_scheduled_at ? formatShortDate(h.last_scheduled_at, h.default_tz) : '—'}
                        </p>
                      </div>
                      {h.autopilot_enabled && !h.autopilot_paused && (
                        <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400 flex-shrink-0">
                          <Rocket className="w-3 h-3" />
                          Auto
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}

function AlertCard({ alert }: { alert: ContentAlert }) {
  const critical = alert.severity === 'critical'
  const domain = alert.site_url.replace(/^https?:\/\//, '').replace(/\/$/, '')

  return (
    <li
      className={`bg-white dark:bg-gray-800 rounded-2xl border p-5 ${
        critical
          ? 'border-red-200 dark:border-red-900/60'
          : 'border-amber-200 dark:border-amber-900/60'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
              critical
                ? 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                : 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
            }`}
          >
            {critical ? <AlertCircle className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                {alert.site_name}
              </h3>
              <Badge
                variant={
                  alert.site_type === 'nodejs' ? 'purple'
                    : alert.site_type === 'static' ? 'warning'
                    : 'default'
                }
              >
                {alert.site_type === 'nodejs' ? 'Node.js' : alert.site_type === 'static' ? 'Static' : 'WordPress'}
              </Badge>
              {alert.autopilot_enabled && (
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                    alert.autopilot_paused
                      ? 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                      : 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400'
                  }`}
                >
                  <Rocket className="w-3 h-3" />
                  {alert.autopilot_paused ? 'Autopilot paused' : 'Autopilot'}
                </span>
              )}
            </div>
            <a
              href={alert.site_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-400 dark:text-gray-500 hover:text-brand-600 dark:hover:text-brand-400 flex items-center gap-1 mt-0.5 transition-colors"
            >
              {domain}
              <ExternalLink className="w-3 h-3" />
            </a>

            <p
              className={`mt-2 text-sm ${
                critical
                  ? 'text-red-700 dark:text-red-300'
                  : 'text-amber-800 dark:text-amber-300'
              }`}
            >
              {alert.message}
            </p>

            <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <dt className="text-gray-400 dark:text-gray-500">Upcoming</dt>
                <dd className="mt-0.5 font-semibold text-gray-900 dark:text-white">
                  {alert.upcoming_count}
                </dd>
              </div>
              <div>
                <dt className="text-gray-400 dark:text-gray-500">Last publish</dt>
                <dd className="mt-0.5 font-semibold text-gray-900 dark:text-white">
                  {alert.last_scheduled_at
                    ? formatShortDate(alert.last_scheduled_at, alert.default_tz)
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-gray-400 dark:text-gray-500">Days left</dt>
                <dd className={`mt-0.5 font-semibold ${critical ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}`}>
                  {alert.days_remaining ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-gray-400 dark:text-gray-500">Zone</dt>
                <dd className="mt-0.5 font-semibold text-gray-900 dark:text-white">
                  {alert.default_tz}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/articles/new?siteId=${alert.site_id}`}
          className="flex items-center gap-1.5 bg-brand-600 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-brand-700 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Create articles
        </Link>
        <Link
          href={`/articles?site_id=${alert.site_id}&status=scheduled`}
          className="flex items-center gap-1.5 border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg text-xs font-medium hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
        >
          <ListChecks className="w-3.5 h-3.5" />
          View scheduled
        </Link>
      </div>
    </li>
  )
}
