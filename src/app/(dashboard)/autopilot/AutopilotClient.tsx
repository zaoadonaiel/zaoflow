'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Rocket, Loader2, ChevronRight, Layers, Pause, Play, Power,
  AlertTriangle, Calendar, ExternalLink, FileText, PencilLine,
} from 'lucide-react'
import Header from '@/components/layout/Header'
import Modal from '@/components/ui/Modal'
import Badge, { statusToBadgeVariant } from '@/components/ui/Badge'
import ModelCombos, { type ModelCombo } from '@/components/articles/ModelCombos'
import { formatInZone } from '@/lib/timezone'
import toast from 'react-hot-toast'

type AutopilotState = 'off' | 'on' | 'paused'

interface AutopilotSite {
  id: string
  name: string
  url: string
  status: string
  default_tz: string
  autopilot_enabled: boolean
  autopilot_paused: boolean
  autopilot_model_combo_id: string | null
  // Supabase's PostgREST returns FK joins as an object when the FK is unique,
  // or an array. Sites -> model_combos is a single-object join in our schema.
  model_combos: ModelCombo | null
}

interface QueuedArticle {
  id: string
  title: string
  status: 'scheduled' | 'draft' | string
  scheduled_at: string | null
  scheduled_tz: string | null
  created_at: string
}

function stateOf(site: AutopilotSite): AutopilotState {
  if (!site.autopilot_enabled) return 'off'
  return site.autopilot_paused ? 'paused' : 'on'
}

export default function AutopilotClient() {
  const [sites, setSites] = useState<AutopilotSite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openSiteId, setOpenSiteId] = useState<string | null>(null)
  const [comboModalSiteId, setComboModalSiteId] = useState<string | null>(null)

  const fetchSites = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/autopilot/sites')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load sites')
      setSites(data.sites || [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sites')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSites() }, [fetchSites])

  async function updateSite(id: string, patch: Partial<Pick<AutopilotSite,
    'autopilot_enabled' | 'autopilot_paused' | 'autopilot_model_combo_id'>>): Promise<AutopilotSite | null> {
    try {
      const res = await fetch(`/api/autopilot/sites/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Update failed')
      setSites((prev) => prev.map((s) => (s.id === id ? data.site as AutopilotSite : s)))
      return data.site as AutopilotSite
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed')
      return null
    }
  }

  const openSite = useMemo(
    () => sites.find((s) => s.id === openSiteId) || null,
    [sites, openSiteId],
  )
  const comboSite = useMemo(
    () => sites.find((s) => s.id === comboModalSiteId) || null,
    [sites, comboModalSiteId],
  )

  return (
    <div>
      <Header
        title="Autopilot"
        subtitle="Keep every site's blog running on its own — three articles queued at all times, refilled as they publish."
      />

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 dark:border-red-900/40 bg-red-50/60 dark:bg-red-900/10 p-6 text-sm text-red-700 dark:text-red-300 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">Autopilot isn&rsquo;t available yet.</p>
            <p className="text-xs mt-1 opacity-90">{error}</p>
          </div>
        </div>
      ) : sites.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-3">
          {sites.map((site) => (
            <SiteCard
              key={site.id}
              site={site}
              onToggle={(next) => handleToggle(site, next)}
              onOpen={() => setOpenSiteId(site.id)}
              onPickCombo={() => setComboModalSiteId(site.id)}
            />
          ))}
        </div>
      )}

      {openSite && (
        <SitePanel
          site={openSite}
          onClose={() => setOpenSiteId(null)}
          onPickCombo={() => setComboModalSiteId(openSite.id)}
          onToggle={(next) => handleToggle(openSite, next)}
        />
      )}

      {comboSite && (
        <ComboPickerModal
          site={comboSite}
          onClose={() => setComboModalSiteId(null)}
          onPick={async (combo) => {
            const updated = await updateSite(comboSite.id, { autopilot_model_combo_id: combo.id })
            if (updated) toast.success(`"${combo.name}" is now this site's Autopilot combo`)
          }}
        />
      )}
    </div>
  )

  /**
   * Off/On/Paused all share one update path so the API can reject an
   * On-without-combo attempt as a single readable error rather than a
   * pair of half-applied writes.
   */
  async function handleToggle(site: AutopilotSite, next: AutopilotState) {
    // Guard: you can't switch to On without a combo. Rather than let the
    // API reject it, open the picker — the user's intent is clear.
    if (next === 'on' && !site.autopilot_model_combo_id) {
      setComboModalSiteId(site.id)
      toast('Pick a Model Combo first — Autopilot needs it to generate.', { icon: 'ℹ️' })
      return
    }
    const patch =
      next === 'off'
        ? { autopilot_enabled: false, autopilot_paused: false }
        : next === 'on'
          ? { autopilot_enabled: true, autopilot_paused: false }
          : { autopilot_enabled: true, autopilot_paused: true }
    await updateSite(site.id, patch)
  }
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800">
      <div className="w-12 h-12 bg-brand-100 dark:bg-brand-900/40 rounded-full flex items-center justify-center">
        <Rocket className="w-6 h-6 text-brand-600 dark:text-brand-400" />
      </div>
      <div>
        <p className="font-medium text-gray-900 dark:text-white">No sites to autopilot yet</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Connect a site first — Autopilot runs against sites you already own.</p>
      </div>
      <Link
        href="/sites"
        className="flex items-center gap-2 bg-brand-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
      >
        Go to Sites
      </Link>
    </div>
  )
}

interface SiteCardProps {
  site: AutopilotSite
  onToggle: (next: AutopilotState) => void
  onOpen: () => void
  onPickCombo: () => void
}

function SiteCard({ site, onToggle, onOpen, onPickCombo }: SiteCardProps) {
  const state = stateOf(site)
  const combo = site.model_combos
  return (
    <div className="rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 md:p-5 flex flex-col md:flex-row md:items-center gap-4">
      <button
        type="button"
        onClick={onOpen}
        className="flex-1 min-w-0 text-left"
      >
        <p className="font-semibold text-gray-900 dark:text-white truncate">{site.name}</p>
        <div className="flex items-center gap-x-2 gap-y-1 flex-wrap text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          <span className="truncate max-w-[16rem]">{site.url.replace(/^https?:\/\//, '')}</span>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <span>{site.default_tz}</span>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPickCombo() }}
            className="inline-flex items-center gap-1 text-brand-600 dark:text-brand-400 hover:underline"
          >
            <Layers className="w-3 h-3" />
            {combo ? combo.name : 'Pick a combo'}
          </button>
        </div>
      </button>

      <StateToggle state={state} onChange={onToggle} />

      <button
        type="button"
        onClick={onOpen}
        className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
      >
        Manage
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  )
}

/**
 * Segmented control for the three states.
 *
 * A single three-way control reads better than two independent switches
 * (Enabled + Paused) which allow the nonsensical "paused-while-off"
 * combination and force the user to think about combining them.
 */
function StateToggle({ state, onChange }: { state: AutopilotState; onChange: (next: AutopilotState) => void }) {
  const options: { value: AutopilotState; label: string; icon: React.ComponentType<{ className?: string }>; activeClass: string }[] = [
    { value: 'off', label: 'Off', icon: Power, activeClass: 'bg-gray-200 dark:bg-gray-600 text-gray-900 dark:text-white' },
    { value: 'paused', label: 'Paused', icon: Pause, activeClass: 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300' },
    { value: 'on', label: 'On', icon: Play, activeClass: 'bg-brand-600 text-white' },
  ]
  return (
    <div className="inline-flex items-center gap-0.5 rounded-xl bg-gray-50 dark:bg-gray-900/40 p-1 border border-gray-100 dark:border-gray-700">
      {options.map(({ value, label, icon: Icon, activeClass }) => {
        const active = state === value
        return (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              active ? activeClass : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        )
      })}
    </div>
  )
}

interface SitePanelProps {
  site: AutopilotSite
  onClose: () => void
  onPickCombo: () => void
  onToggle: (next: AutopilotState) => void
}

function SitePanel({ site, onClose, onPickCombo, onToggle }: SitePanelProps) {
  const [articles, setArticles] = useState<QueuedArticle[]>([])
  const [loading, setLoading] = useState(true)
  const combo = site.model_combos
  const state = stateOf(site)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/autopilot/sites/${site.id}/articles`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setArticles(d.articles || []) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [site.id])

  return (
    <Modal open onClose={onClose} title={<><Rocket className="w-4 h-4 text-brand-600 dark:text-brand-400" />{site.name}</>} maxWidth="max-w-2xl">
      <div className="space-y-5">
        {/* Model combo — mandatory before the toggle can hit On. */}
        <section>
          <h3 className="text-xs uppercase font-semibold text-gray-500 dark:text-gray-400 tracking-wide mb-2">Model Combo</h3>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30 p-3 flex items-center gap-3">
            <Layers className="w-4 h-4 text-gray-400" />
            {combo ? (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{combo.name}</p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                  {[combo.idea_model, combo.article_model, combo.seo_model, combo.image_model]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
            ) : (
              <p className="flex-1 text-sm text-gray-500 dark:text-gray-400">
                No combo picked yet — required to turn Autopilot on.
              </p>
            )}
            <button
              type="button"
              onClick={onPickCombo}
              className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-medium hover:bg-brand-700 transition-colors"
            >
              {combo ? 'Change' : 'Pick combo'}
            </button>
          </div>
        </section>

        <section>
          <h3 className="text-xs uppercase font-semibold text-gray-500 dark:text-gray-400 tracking-wide mb-2">Autopilot</h3>
          <div className="flex items-center gap-3 flex-wrap">
            <StateToggle state={state} onChange={onToggle} />
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {state === 'on'    && 'Queueing three articles in the next 72 hours; refilling as they publish.'}
              {state === 'paused' && 'Queued articles still publish; no new ones will be generated.'}
              {state === 'off'   && 'Nothing is queued or published automatically.'}
            </p>
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs uppercase font-semibold text-gray-500 dark:text-gray-400 tracking-wide">Scheduled by Autopilot</h3>
            <span className="text-[11px] text-gray-400">{articles.length} in queue</span>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          ) : articles.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 py-8 text-center">
              <FileText className="w-6 h-6 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">Nothing queued yet.</p>
              {state === 'on' && (
                <p className="text-[11px] text-gray-400 mt-1">The next tick will start filling the queue.</p>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-700 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              {articles.map((a) => (
                <li key={a.id} className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/articles/${a.id}`}
                      className="block text-sm font-medium text-gray-900 dark:text-white truncate hover:text-brand-600 dark:hover:text-brand-400"
                    >
                      {a.title || 'Untitled draft'}
                    </Link>
                    <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                      <Calendar className="w-3 h-3" />
                      {a.scheduled_at
                        ? formatInZone(a.scheduled_at, a.scheduled_tz || site.default_tz, 'long')
                        : 'No slot — held as draft'}
                    </div>
                  </div>
                  <Badge variant={statusToBadgeVariant(a.status)}>{a.status}</Badge>
                  <Link
                    href={`/articles/${a.id}`}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    title="Edit / reschedule"
                  >
                    <PencilLine className="w-3.5 h-3.5" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-700">
          <a
            href={site.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            <ExternalLink className="w-3 h-3" />
            {site.url.replace(/^https?:\/\//, '')}
          </a>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Done
          </button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * The combo picker reuses the Article Writer's ModelCombos component with
 * `mode="pick-only"` — same fetch, same expired-model swap flow, no save
 * row. Selecting a combo patches the site and closes the modal.
 */
function ComboPickerModal({
  site, onClose, onPick,
}: { site: AutopilotSite; onClose: () => void; onPick: (combo: ModelCombo) => Promise<void> }) {
  return (
    <Modal
      open
      onClose={onClose}
      title={<>Pick a Model Combo for <span className="text-brand-600 dark:text-brand-400">{site.name}</span></>}
      maxWidth="max-w-xl"
    >
      <div className="space-y-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Autopilot uses this combo for every article it generates on this site. Change it any time —
          articles already scheduled keep whatever combo was picked when they were generated.
        </p>
        <ModelCombos
          currentModels={{ idea: '', article: '', seo: '', image: '' }}
          mode="pick-only"
          selectedId={site.autopilot_model_combo_id}
          loadLabel="Use for Autopilot"
          onLoad={async (combo) => {
            await onPick(combo)
            onClose()
          }}
        />
        <p className="text-[11px] text-gray-400">
          Need a new combo? Save one from the <Link href="/articles/new" className="text-brand-600 dark:text-brand-400 hover:underline">Article Writer</Link> and it will show up here.
        </p>
      </div>
    </Modal>
  )
}
