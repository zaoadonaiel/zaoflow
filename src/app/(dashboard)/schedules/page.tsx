'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Calendar, Plus, Trash2, Clock, Globe, Sparkles, FolderOpen, Loader2, Pencil, Play, ChevronDown, ChevronUp, ExternalLink, CheckCircle2, XCircle, PauseCircle, Filter, X } from 'lucide-react'
import Header from '@/components/layout/Header'
import Modal from '@/components/ui/Modal'
import Badge from '@/components/ui/Badge'
import ModelSelect from '@/components/ui/ModelSelect'
import { AVAILABLE_MODELS } from '@/lib/openrouter'
import type { Article, Schedule, Site } from '@/types'
import { format, formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'

interface WPCategory { id: number; name: string; count: number }
interface HistoryArticle {
  id: string; title: string; status: string
  wp_post_url?: string; word_count?: number; created_at: string
}

const FREQUENCY_OPTIONS = [
  { value: 'daily', label: 'Every day', desc: 'Publish once per day' },
  { value: 'every_48h', label: 'Every 48 hours', desc: 'Publish every 2 days' },
  { value: 'weekly', label: 'Once a week', desc: 'Publish once per week' },
  { value: 'twice_monthly', label: 'Twice a month', desc: 'Publish on the 1st and 15th' },
  { value: 'monthly', label: 'Once a month', desc: 'Publish once per month' },
  { value: 'custom', label: 'Custom (Cron)', desc: 'Advanced cron expression' },
]

const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Singapore', 'Australia/Sydney',
]

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [upcoming, setUpcoming] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({
    name: '',
    site_id: '',
    frequency: 'weekly' as Schedule['frequency'],
    custom_cron: '',
    times_of_day: ['09:00'] as string[],
    timezone: 'UTC',
    ai_model: AVAILABLE_MODELS[0].id,
    topic_prompt: '',
    wp_category_id: '' as number | '',
  })
  const [categories, setCategories] = useState<WPCategory[]>([])
  const [loadingCats, setLoadingCats] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [historyMap, setHistoryMap] = useState<Record<string, HistoryArticle[]>>({})
  // 'all' rather than '' so the modal can pick the same slot for the reset row
  // as it does for every other option.
  const [upcomingFilterSiteId, setUpcomingFilterSiteId] = useState<string>('all')
  const [upcomingFilterOpen, setUpcomingFilterOpen] = useState(false)

  function addTimeSlot() {
    setForm((f) => ({ ...f, times_of_day: [...f.times_of_day, '12:00'] }))
  }
  function removeTimeSlot(i: number) {
    setForm((f) => ({ ...f, times_of_day: f.times_of_day.filter((_, idx) => idx !== i) }))
  }
  function updateTimeSlot(i: number, val: string) {
    setForm((f) => {
      const next = [...f.times_of_day]
      next[i] = val
      return { ...f, times_of_day: next }
    })
  }
  function applyPreset(times: string[]) {
    setForm((f) => ({ ...f, times_of_day: times }))
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [schRes, siteRes, artRes] = await Promise.all([
        fetch('/api/schedules'),
        fetch('/api/sites'),
        fetch('/api/articles?status=scheduled'),
      ])
      const [schData, siteData, artData] = await Promise.all([
        schRes.json(),
        siteRes.json(),
        artRes.json(),
      ])
      setSchedules(schData.schedules || [])
      setSites(siteData.sites || [])
      const scheduledArticles: Article[] = (artData.articles || []).slice()
      scheduledArticles.sort((a: Article, b: Article) => {
        const aTime = a.scheduled_at ? new Date(a.scheduled_at).getTime() : Number.POSITIVE_INFINITY
        const bTime = b.scheduled_at ? new Date(b.scheduled_at).getTime() : Number.POSITIVE_INFINITY
        return aTime - bTime
      })
      setUpcoming(scheduledArticles)
      if (siteData.sites?.length > 0 && !form.site_id) {
        setForm((f) => ({ ...f, site_id: siteData.sites[0].id }))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    if (!form.site_id) return
    setLoadingCats(true)
    setCategories([])
    fetch(`/api/sites/${form.site_id}/categories`)
      .then((r) => r.json())
      .then((d) => setCategories(d.categories || []))
      .catch(() => {})
      .finally(() => setLoadingCats(false))
  }, [form.site_id])

  async function createSchedule() {
    if (!form.name.trim()) { toast.error('Name is required'); return }
    if (!form.site_id) { toast.error('Select a site'); return }
    if (!form.topic_prompt.trim()) { toast.error('Topic prompt is required'); return }
    if (form.frequency === 'custom' && !form.custom_cron.trim()) { toast.error('Enter a cron expression'); return }
    if (form.times_of_day.length === 0) { toast.error('Add at least one publish time'); return }

    setCreating(true)
    try {
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSchedules((prev) => [data.schedule, ...prev])
      closeModal()
      toast.success('Schedule created!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create')
    } finally {
      setCreating(false)
    }
  }

  async function runNow(schedule: Schedule) {
    setRunningId(schedule.id)
    const toastId = toast.loading('Generating article…')
    try {
      const res = await fetch(`/api/schedules/${schedule.id}/run`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(`Published: "${data.title}"`, { id: toastId, duration: 6000 })
      setSchedules((prev) => prev.map((s) =>
        s.id === schedule.id
          ? { ...s, articles_generated: (s.articles_generated || 0) + 1, last_run: new Date().toISOString() }
          : s
      ))
      // Refresh history if expanded
      if (expandedId === schedule.id) loadHistory(schedule.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Run failed', { id: toastId })
    } finally {
      setRunningId(null)
    }
  }

  async function loadHistory(id: string) {
    const res = await fetch(`/api/schedules/${id}/history`)
    const data = await res.json()
    setHistoryMap((prev) => ({ ...prev, [id]: data.articles || [] }))
  }

  function toggleHistory(id: string) {
    if (expandedId === id) {
      setExpandedId(null)
    } else {
      setExpandedId(id)
      if (!historyMap[id]) loadHistory(id)
    }
  }

  function openEdit(schedule: Schedule) {
    setForm({
      name: schedule.name,
      site_id: schedule.site_id,
      frequency: schedule.frequency,
      custom_cron: schedule.custom_cron || '',
      times_of_day: schedule.times_of_day?.length ? schedule.times_of_day : [schedule.time_of_day || '09:00'],
      timezone: schedule.timezone,
      ai_model: schedule.ai_model,
      topic_prompt: schedule.topic_prompt,
      wp_category_id: schedule.wp_category_id || '',
    })
    setEditingId(schedule.id)
    setShowCreate(true)
  }

  function closeModal() {
    setShowCreate(false)
    setEditingId(null)
    setForm({
      name: '', site_id: sites[0]?.id || '', frequency: 'weekly',
      custom_cron: '', times_of_day: ['09:00'], timezone: 'UTC',
      ai_model: AVAILABLE_MODELS[0].id, topic_prompt: '', wp_category_id: '',
    })
  }

  async function saveEdit() {
    if (!editingId) return
    if (!form.name.trim()) { toast.error('Name is required'); return }
    if (!form.topic_prompt.trim()) { toast.error('Topic prompt is required'); return }
    if (form.frequency === 'custom' && !form.custom_cron.trim()) { toast.error('Enter a cron expression'); return }
    if (form.times_of_day.length === 0) { toast.error('Add at least one publish time'); return }

    setCreating(true)
    try {
      const res = await fetch(`/api/schedules/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          site_id: form.site_id,
          frequency: form.frequency,
          custom_cron: form.custom_cron || null,
          time_of_day: form.times_of_day[0],
          times_of_day: form.times_of_day,
          timezone: form.timezone,
          ai_model: form.ai_model,
          topic_prompt: form.topic_prompt,
          wp_category_id: form.wp_category_id || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSchedules((prev) => prev.map((s) => s.id === editingId ? { ...s, ...data.schedule } : s))
      closeModal()
      toast.success('Schedule updated!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setCreating(false)
    }
  }

  async function toggleSchedule(id: string, isActive: boolean) {
    try {
      const res = await fetch(`/api/schedules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !isActive }),
      })
      if (!res.ok) throw new Error()
      setSchedules((prev) => prev.map((s) => s.id === id ? { ...s, is_active: !isActive } : s))
    } catch {
      toast.error('Failed to update schedule')
    }
  }

  async function deleteSchedule(id: string, name: string) {
    if (!confirm(`Delete schedule "${name}"?`)) return
    try {
      const res = await fetch(`/api/schedules/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setSchedules((prev) => prev.filter((s) => s.id !== id))
      toast.success('Schedule deleted')
    } catch {
      toast.error('Failed to delete')
    }
  }

  return (
    <div>
      <Header
        title="Schedules"
        subtitle="Automate recurring content publishing"
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New schedule
          </button>
        }
      />

      {!loading && upcoming.length > 0 && (() => {
        const activeSite = upcomingFilterSiteId === 'all'
          ? null
          : sites.find((s) => s.id === upcomingFilterSiteId) || null
        const visibleUpcoming = upcomingFilterSiteId === 'all'
          ? upcoming
          : upcoming.filter((a) => a.site_id === upcomingFilterSiteId)
        return (
        <section className="mb-8">
          <div className="flex flex-col gap-3 mb-3 sm:flex-row sm:items-baseline sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wide">Upcoming articles</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {visibleUpcoming.length} scheduled to publish{activeSite ? ` · ${activeSite.name}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setUpcomingFilterOpen(true)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  activeSite
                    ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-200 dark:border-brand-800 text-brand-700 dark:text-brand-400'
                    : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <Filter className="w-3.5 h-3.5" />
                {activeSite ? activeSite.name : 'All sites'}
              </button>
              {activeSite && (
                <button
                  type="button"
                  onClick={() => setUpcomingFilterSiteId('all')}
                  aria-label="Clear site filter"
                  className="flex items-center justify-center w-7 h-7 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <Link href="/articles?status=scheduled" className="text-xs font-medium text-brand-600 hover:text-brand-700 ml-auto sm:ml-1">
                View all →
              </Link>
            </div>
          </div>
          {visibleUpcoming.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 border-dashed py-10 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No scheduled articles{activeSite ? ` for ${activeSite.name}` : ''}.
              </p>
              {activeSite && (
                <button
                  type="button"
                  onClick={() => setUpcomingFilterSiteId('all')}
                  className="mt-2 text-xs font-medium text-brand-600 hover:text-brand-700"
                >
                  Show all sites
                </button>
              )}
            </div>
          ) : (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            {visibleUpcoming.map((article, i) => (
              <div
                key={article.id}
                className={`px-4 sm:px-5 py-3.5 flex items-start sm:items-center gap-3 sm:gap-4 hover:bg-gray-50/60 dark:hover:bg-gray-700/30 transition-colors ${
                  i > 0 ? 'border-t border-gray-50 dark:border-gray-700' : ''
                }`}
              >
                <div className="flex-shrink-0 w-12 sm:w-14 text-center">
                  {article.scheduled_at ? (
                    <>
                      <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">
                        {format(new Date(article.scheduled_at), 'MMM')}
                      </div>
                      <div className="text-lg font-semibold text-gray-900 dark:text-white leading-tight">
                        {format(new Date(article.scheduled_at), 'd')}
                      </div>
                      <div className="text-[10px] text-gray-400">
                        {format(new Date(article.scheduled_at), 'h:mmaaa')}
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-gray-300">—</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2">
                    <Link
                      href={`/articles/${article.id}`}
                      className="block font-medium text-sm text-gray-900 dark:text-gray-100 hover:text-brand-600 dark:hover:text-brand-400 transition-colors line-clamp-2 flex-1 min-w-0"
                    >
                      {article.title}
                    </Link>
                    {/* Status pill lives next to the title on mobile so the row
                        does not stack an unrelated pill under the meta line. */}
                    <div className="sm:hidden flex-shrink-0">
                      {article.is_paused ? (
                        <Badge variant="warning">
                          <PauseCircle className="w-3 h-3 mr-1" />
                          Paused
                        </Badge>
                      ) : (
                        <Badge variant="info">Scheduled</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-1 text-xs text-gray-400 dark:text-gray-500">
                    <span className="flex items-center gap-1 truncate min-w-0 max-w-full">
                      <Globe className="w-3 h-3 flex-shrink-0" />
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      <span className="truncate">{(article as any).sites?.name || 'Unknown site'}</span>
                    </span>
                    {article.word_count ? (
                      <span className="flex-shrink-0">{article.word_count.toLocaleString()} words</span>
                    ) : null}
                    {article.scheduled_at && (
                      <span className="flex-shrink-0">
                        {formatDistanceToNow(new Date(article.scheduled_at), { addSuffix: true })}
                      </span>
                    )}
                  </div>
                </div>
                <div className="hidden sm:flex flex-shrink-0 items-center gap-2">
                  {article.is_paused ? (
                    <Badge variant="warning">
                      <PauseCircle className="w-3 h-3 mr-1" />
                      Paused
                    </Badge>
                  ) : (
                    <Badge variant="info">Scheduled</Badge>
                  )}
                  <Link
                    href={`/articles/${article.id}`}
                    className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    title="Edit article"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Link>
                </div>
                <Link
                  href={`/articles/${article.id}`}
                  className="sm:hidden flex-shrink-0 p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  title="Edit article"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Link>
              </div>
            ))}
          </div>
          )}
        </section>
        )
      })()}

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 animate-pulse">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4 mb-3" />
              <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : schedules.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 border-dashed">
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-2xl flex items-center justify-center">
              <Calendar className="w-8 h-8 text-gray-400" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">No schedules yet</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Set up autopilot publishing and Zao Flo handles the rest</p>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 bg-brand-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
            >
              <Plus className="w-4 h-4" />Create schedule
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {schedules.map((schedule) => (
            <div key={schedule.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 hover:border-gray-200 dark:hover:border-gray-600 transition-colors overflow-hidden">
              <div className="p-4 sm:p-5">
                {/* Header row: name + Active toggle. Toggle sits inline with
                    the name on every width so it stays a one-tap control
                    instead of hiding under a stack of action buttons. */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <h3 className="font-semibold text-gray-900 dark:text-white truncate flex-1 min-w-0">{schedule.name}</h3>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-xs font-medium ${schedule.is_active ? 'text-green-600' : 'text-gray-400'}`}>
                      {schedule.is_active ? 'Active' : 'Paused'}
                    </span>
                    <button
                      onClick={() => toggleSchedule(schedule.id, schedule.is_active)}
                      className={`relative inline-flex h-7 w-[52px] items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                        schedule.is_active ? 'bg-green-500 focus:ring-green-500' : 'bg-gray-200 focus:ring-gray-300'
                      }`}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200 ${
                        schedule.is_active ? 'translate-x-[28px]' : 'translate-x-1'
                      }`} />
                    </button>
                  </div>
                </div>

                {/* Meta chips — wrap freely on mobile so long times/model
                    names do not push the row out of the viewport. */}
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-gray-500 dark:text-gray-400 mb-2">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <Globe className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <span className="truncate">{(schedule as any).sites?.name || 'Unknown site'}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    {FREQUENCY_OPTIONS.find((f) => f.value === schedule.frequency)?.label}
                  </span>
                  <span className="flex items-center gap-1.5 min-w-0">
                    <Clock className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    <span className="truncate">
                      {(schedule.times_of_day?.length ? schedule.times_of_day : [schedule.time_of_day]).join(' · ')} · {schedule.timezone}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 min-w-0">
                    <Sparkles className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    <span className="truncate">{AVAILABLE_MODELS.find((m) => m.id === schedule.ai_model)?.name || schedule.ai_model}</span>
                  </span>
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 line-clamp-2 mb-3">{schedule.topic_prompt}</p>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs mb-3">
                  <span className="font-semibold text-gray-700 dark:text-gray-300">{schedule.articles_generated} published</span>
                  {schedule.last_run && (
                    <span className="text-gray-400 dark:text-gray-500">Last: {formatDistanceToNow(new Date(schedule.last_run), { addSuffix: true })}</span>
                  )}
                  {schedule.next_run && (
                    <span className="text-gray-400 dark:text-gray-500">Next: {format(new Date(schedule.next_run), 'MMM d, h:mm a')}</span>
                  )}
                </div>

                {/* Action row on its own line so the three buttons keep their
                    labels on a phone instead of collapsing into stacked icons
                    next to the toggle. */}
                <div className="flex items-center gap-1 flex-wrap border-t border-gray-100 dark:border-gray-700 pt-3 -mx-1">
                  <button
                    onClick={() => runNow(schedule)}
                    disabled={runningId === schedule.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 hover:bg-brand-50 rounded-lg transition-colors disabled:opacity-50"
                    title="Generate and publish one article now"
                  >
                    {runningId === schedule.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Play className="w-3.5 h-3.5" />}
                    {runningId === schedule.id ? 'Running…' : 'Run now'}
                  </button>
                  <button
                    onClick={() => openEdit(schedule)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </button>
                  <button
                    onClick={() => toggleHistory(schedule.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    {expandedId === schedule.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    {expandedId === schedule.id ? 'Hide history' : 'History'}
                  </button>
                  <button
                    onClick={() => deleteSchedule(schedule.id, schedule.name)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors ml-auto"
                    title="Delete schedule"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* History panel */}
              {expandedId === schedule.id && (
                <div className="border-t border-gray-100 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/40 px-4 sm:px-5 py-4">
                  {!historyMap[schedule.id] ? (
                    <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />Loading history…
                    </div>
                  ) : historyMap[schedule.id].length === 0 ? (
                    <p className="text-xs text-gray-400 dark:text-gray-500 py-2">No articles published yet — click <strong>Run now</strong> to publish the first one.</p>
                  ) : (
                    <div className="space-y-3">
                      {historyMap[schedule.id].map((a) => (
                        <div key={a.id} className="flex items-start gap-2 text-xs">
                          {a.status === 'published'
                            ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0 mt-0.5" />
                            : <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start gap-2">
                              <span className="flex-1 text-gray-700 dark:text-gray-300 font-medium line-clamp-2 min-w-0">{a.title}</span>
                              {a.wp_post_url && (
                                <a href={a.wp_post_url} target="_blank" rel="noopener noreferrer"
                                  className="text-brand-600 hover:text-brand-700 flex-shrink-0 mt-0.5">
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-gray-400 dark:text-gray-500 mt-0.5">
                              {a.word_count ? <span>{a.word_count.toLocaleString()} words</span> : null}
                              <span>{formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      <Modal open={showCreate} onClose={closeModal} title={editingId ? 'Edit Schedule' : 'Create Publishing Schedule'} maxWidth="max-w-xl">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Schedule name</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Tech Blog Weekly" required
              className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">WordPress Site</label>
            {sites.length === 0 ? (
              <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <Globe className="w-5 h-5 text-amber-600 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-800">No sites connected yet</p>
                  <p className="text-xs text-amber-600 mt-0.5">You need to connect a WordPress site before creating a schedule.</p>
                </div>
                <a
                  href="/sites"
                  onClick={() => setShowCreate(false)}
                  className="flex-shrink-0 bg-amber-600 text-white text-xs font-medium px-3 py-2 rounded-lg hover:bg-amber-700 transition-colors"
                >
                  Add site →
                </a>
              </div>
            ) : (
              <select value={form.site_id} onChange={(e) => setForm({ ...form, site_id: e.target.value })}
                className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500">
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Publishing frequency</label>
            <select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as Schedule['frequency'] })}
              className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500">
              {FREQUENCY_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label} — {f.desc}</option>)}
            </select>
          </div>

          {form.frequency === 'custom' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Cron expression</label>
              <input type="text" value={form.custom_cron} onChange={(e) => setForm({ ...form, custom_cron: e.target.value })}
                placeholder="0 9 * * 1 (every Monday at 9am)"
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Publish times</label>
              <div className="flex items-center gap-1.5">
                {[
                  { label: '1×', times: ['09:00'] },
                  { label: '2×', times: ['09:00', '18:00'] },
                  { label: '3×', times: ['08:00', '13:00', '19:00'] },
                ].map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => applyPreset(p.times)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border ${
                      form.times_of_day.length === p.times.length && form.times_of_day.join() === p.times.join()
                        ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-400'
                        : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500 hover:text-gray-700 dark:hover:text-gray-200'
                    }`}
                  >
                    {p.label} daily
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              {form.times_of_day.map((t, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="time"
                    value={t}
                    onChange={(e) => updateTimeSlot(i, e.target.value)}
                    className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  {form.times_of_day.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeTimeSlot(i)}
                      className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                    >
                      <span className="text-lg leading-none">×</span>
                    </button>
                  )}
                </div>
              ))}
              {form.times_of_day.length < 6 && (
                <button
                  type="button"
                  onClick={addTimeSlot}
                  className="w-full py-2 border border-dashed border-gray-300 dark:border-gray-600 rounded-xl text-xs text-gray-400 dark:text-gray-500 hover:text-brand-600 dark:hover:text-brand-400 hover:border-brand-400 dark:hover:border-brand-600 transition-colors"
                >
                  + Add another time slot
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Timezone</label>
            <select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500">
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">AI model</label>
              <ModelSelect
                value={form.ai_model}
                onChange={(v) => setForm({ ...form, ai_model: v })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-1.5">
                <FolderOpen className="w-3.5 h-3.5 text-gray-400" />Category
              </label>
              {loadingCats ? (
                <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-xs text-gray-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />Loading...
                </div>
              ) : (
                <select
                  value={form.wp_category_id}
                  onChange={(e) => setForm({ ...form, wp_category_id: e.target.value ? Number(e.target.value) : '' })}
                  className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">Uncategorized</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Topic / content strategy prompt</label>
            <textarea value={form.topic_prompt} onChange={(e) => setForm({ ...form, topic_prompt: e.target.value })}
              placeholder="Describe what kind of articles to generate. e.g. 'Write SEO articles about dog training tips for first-time owners. Target beginner dog owners. Focus on actionable advice.'"
              rows={4} required
              className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none" />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Zao Flo will use this to generate unique article topics each time</p>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={closeModal}
              className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              Cancel
            </button>
            <button onClick={editingId ? saveEdit : createSchedule} disabled={creating}
              className="flex-1 bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50">
              {creating ? (editingId ? 'Saving...' : 'Creating...') : (editingId ? 'Save changes' : 'Create schedule')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Site filter for Upcoming articles — counts come from the loaded upcoming
          list so the number next to each site reflects what the user is about
          to see, not the site's lifetime article count. */}
      <Modal open={upcomingFilterOpen} onClose={() => setUpcomingFilterOpen(false)} title="Filter by site" maxWidth="max-w-md">
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => { setUpcomingFilterSiteId('all'); setUpcomingFilterOpen(false) }}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              upcomingFilterSiteId === 'all'
                ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            <span className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-gray-400" />
              All sites
            </span>
            <span className="text-xs text-gray-400">{upcoming.length}</span>
          </button>
          {sites.map((s) => {
            const n = upcoming.filter((a) => a.site_id === s.id).length
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => { setUpcomingFilterSiteId(s.id); setUpcomingFilterOpen(false) }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  upcomingFilterSiteId === s.id
                    ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                } ${n === 0 ? 'opacity-60' : ''}`}
              >
                <span className="truncate">{s.name}</span>
                <span className="text-xs text-gray-400 flex-shrink-0 ml-2">{n}</span>
              </button>
            )
          })}
        </div>
      </Modal>
    </div>
  )
}
