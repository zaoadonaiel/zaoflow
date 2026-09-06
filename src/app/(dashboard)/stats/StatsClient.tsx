'use client'

import { useMemo, useState } from 'react'
import { BarChart3, Sparkles, DollarSign, FileText, Filter, X } from 'lucide-react'
import { money } from '@/lib/format'

export type Step = 'idea' | 'article' | 'seo' | 'image'

export interface UsageRow {
  step: Step
  model: string
  cost_usd: number | null
  article_id: string | null
  created_at: string
  site_name: string | null
}

const STEPS: Step[] = ['idea', 'article', 'seo', 'image']
const STEP_LABELS: Record<Step, string> = {
  idea: 'Idea',
  article: 'Article',
  seo: 'SEO',
  image: 'Image',
}
const COMBO_STEPS: Step[] = ['idea', 'article', 'image']

type RangePreset = '7d' | '30d' | '90d' | 'all' | 'custom'
const RANGE_PRESETS: { key: RangePreset; label: string }[] = [
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Custom' },
]

function daysAgoISO(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

interface Props {
  rows: UsageRow[]
}

export default function StatsClient({ rows }: Props) {
  const [preset, setPreset] = useState<RangePreset>('30d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [selectedSteps, setSelectedSteps] = useState<Set<Step>>(new Set())
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [selectedSite, setSelectedSite] = useState<string>('')

  // All distinct models and sites, for the dropdowns. Sorted alphabetically so
  // the dropdown order is stable across renders.
  const allModels = useMemo(() => {
    const s = new Set<string>()
    for (const r of rows) s.add(r.model)
    return [...s].sort()
  }, [rows])

  const allSites = useMemo(() => {
    const s = new Set<string>()
    for (const r of rows) if (r.site_name) s.add(r.site_name)
    return [...s].sort()
  }, [rows])

  // Filtered row set — every section reads from this. Filters are ANDed:
  // narrowing one dimension does not widen another.
  const filtered = useMemo(() => {
    let startISO: string | null = null
    let endISO: string | null = null
    if (preset === '7d') startISO = daysAgoISO(7)
    else if (preset === '30d') startISO = daysAgoISO(30)
    else if (preset === '90d') startISO = daysAgoISO(90)
    else if (preset === 'custom') {
      if (customStart) startISO = new Date(customStart + 'T00:00:00').toISOString()
      if (customEnd) endISO = new Date(customEnd + 'T23:59:59').toISOString()
    }

    return rows.filter((r) => {
      if (startISO && r.created_at < startISO) return false
      if (endISO && r.created_at > endISO) return false
      if (selectedSteps.size > 0 && !selectedSteps.has(r.step)) return false
      if (selectedModel && r.model !== selectedModel) return false
      if (selectedSite && r.site_name !== selectedSite) return false
      return true
    })
  }, [rows, preset, customStart, customEnd, selectedSteps, selectedModel, selectedSite])

  // --- totals ---
  const totalCost = filtered.reduce((n, r) => n + (r.cost_usd ?? 0), 0)
  const totalUses = filtered.length
  const articleIds = useMemo(() => {
    const s = new Set<string>()
    for (const r of filtered) if (r.article_id) s.add(r.article_id)
    return s
  }, [filtered])

  // --- by step + model ---
  type StepModelAgg = { model: string; uses: number; cost: number }
  const byStepModel = useMemo(() => {
    const out: Record<Step, Map<string, StepModelAgg>> = {
      idea: new Map(), article: new Map(), seo: new Map(), image: new Map(),
    }
    for (const r of filtered) {
      const bucket = out[r.step]
      const agg = bucket.get(r.model) ?? { model: r.model, uses: 0, cost: 0 }
      agg.uses += 1
      agg.cost += r.cost_usd ?? 0
      bucket.set(r.model, agg)
    }
    return out
  }, [filtered])

  // --- spend rollups ---
  const spendByModel = useMemo(() => {
    const m = new Map<string, { model: string; uses: number; cost: number }>()
    for (const r of filtered) {
      const agg = m.get(r.model) ?? { model: r.model, uses: 0, cost: 0 }
      agg.uses += 1
      agg.cost += r.cost_usd ?? 0
      m.set(r.model, agg)
    }
    return [...m.values()].sort((a, b) => b.cost - a.cost)
  }, [filtered])

  const spendByStep = useMemo(() => {
    const m: Record<Step, { uses: number; cost: number }> = {
      idea: { uses: 0, cost: 0 },
      article: { uses: 0, cost: 0 },
      seo: { uses: 0, cost: 0 },
      image: { uses: 0, cost: 0 },
    }
    for (const r of filtered) {
      m[r.step].uses += 1
      m[r.step].cost += r.cost_usd ?? 0
    }
    return m
  }, [filtered])

  // --- by site: top model per step for each site ---
  type SiteAgg = {
    siteName: string
    uses: number
    cost: number
    topByStep: Partial<Record<Step, { model: string; uses: number }>>
    counts: Record<Step, Map<string, number>>
  }
  const sites = useMemo(() => {
    const siteMap = new Map<string, SiteAgg>()
    for (const r of filtered) {
      const siteName = r.site_name
      if (!siteName) continue
      let agg = siteMap.get(siteName)
      if (!agg) {
        agg = {
          siteName,
          uses: 0,
          cost: 0,
          topByStep: {},
          counts: { idea: new Map(), article: new Map(), seo: new Map(), image: new Map() },
        }
        siteMap.set(siteName, agg)
      }
      agg.uses += 1
      agg.cost += r.cost_usd ?? 0
      const c = agg.counts[r.step]
      c.set(r.model, (c.get(r.model) ?? 0) + 1)
    }
    for (const agg of siteMap.values()) {
      for (const step of STEPS) {
        let bestModel = ''
        let bestUses = 0
        for (const [model, uses] of agg.counts[step]) {
          if (uses > bestUses) { bestModel = model; bestUses = uses }
        }
        if (bestUses > 0) agg.topByStep[step] = { model: bestModel, uses: bestUses }
      }
    }
    return [...siteMap.values()].sort((a, b) => b.uses - a.uses)
  }, [filtered])

  // --- combos: idea + article + image model per article ---
  // Retries and regenerations can produce several rows per (article, step);
  // the latest one wins because that is the model the user landed on.
  type ComboAgg = {
    key: string
    idea: string | null
    article: string | null
    image: string | null
    articles: number
    cost: number
  }
  const comboList = useMemo(() => {
    const perArticle = new Map<string, {
      latest: Partial<Record<Step, { model: string; at: string }>>
      cost: number
    }>()
    for (const r of filtered) {
      if (!r.article_id) continue
      let entry = perArticle.get(r.article_id)
      if (!entry) { entry = { latest: {}, cost: 0 }; perArticle.set(r.article_id, entry) }
      entry.cost += r.cost_usd ?? 0
      const prev = entry.latest[r.step]
      if (!prev || r.created_at > prev.at) entry.latest[r.step] = { model: r.model, at: r.created_at }
    }
    const combos = new Map<string, ComboAgg>()
    for (const entry of perArticle.values()) {
      if (!entry.latest.article) continue
      const idea = entry.latest.idea?.model ?? null
      const article = entry.latest.article?.model ?? null
      const image = entry.latest.image?.model ?? null
      const key = `${idea ?? '—'}|${article ?? '—'}|${image ?? '—'}`
      const agg = combos.get(key) ?? { key, idea, article, image, articles: 0, cost: 0 }
      agg.articles += 1
      agg.cost += entry.cost
      combos.set(key, agg)
    }
    return [...combos.values()].sort((a, b) => b.articles - a.articles)
  }, [filtered])

  const summary = [
    { label: 'Total Spend', value: money(totalCost), icon: DollarSign, color: 'text-brand-600 bg-brand-50 dark:bg-brand-950/40' },
    { label: 'Generations', value: totalUses.toLocaleString(), icon: Sparkles, color: 'text-purple-600 bg-purple-50 dark:bg-purple-950/40' },
    { label: 'Articles', value: articleIds.size.toLocaleString(), icon: FileText, color: 'text-green-600 bg-green-50 dark:bg-green-950/40' },
    { label: 'Avg $ / Article', value: articleIds.size > 0 ? money(totalCost / articleIds.size) : '—', icon: BarChart3, color: 'text-amber-600 bg-amber-50 dark:bg-amber-950/40' },
  ]

  function toggleStep(step: Step) {
    setSelectedSteps((prev) => {
      const next = new Set(prev)
      if (next.has(step)) next.delete(step)
      else next.add(step)
      return next
    })
  }

  const anyFilterActive =
    preset !== 'all' || selectedSteps.size > 0 || selectedModel !== '' || selectedSite !== ''

  function resetFilters() {
    setPreset('all')
    setCustomStart('')
    setCustomEnd('')
    setSelectedSteps(new Set())
    setSelectedModel('')
    setSelectedSite('')
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Stats</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Which models and pipelines you use — and what they cost.
        </p>
      </div>

      {/* Filter bar */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 mb-6 space-y-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">
          <Filter className="w-3.5 h-3.5" />
          Filters
          {anyFilterActive && (
            <button
              type="button"
              onClick={resetFilters}
              className="ml-auto flex items-center gap-1 text-xs normal-case tracking-normal text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          )}
        </div>

        {/* Date range */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center bg-gray-50 dark:bg-gray-900 rounded-xl p-1">
            {RANGE_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPreset(p.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  preset === p.key
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="px-3 py-1.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <span className="text-xs text-gray-400 dark:text-gray-500">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="px-3 py-1.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          )}
        </div>

        {/* Task type pills */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400 mr-1">Task type</span>
          {STEPS.map((step) => {
            const active = selectedSteps.has(step)
            return (
              <button
                key={step}
                type="button"
                onClick={() => toggleStep(step)}
                aria-pressed={active}
                className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                  active
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400'
                    : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-500'
                }`}
              >
                {STEP_LABELS[step]}
              </button>
            )
          })}
          {selectedSteps.size === 0 && (
            <span className="text-xs text-gray-400 dark:text-gray-500">(all)</span>
          )}
        </div>

        {/* Model + site dropdowns */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            AI model
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="px-3 py-1.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
            >
              <option value="">All models</option>
              {allModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            Site
            <select
              value={selectedSite}
              onChange={(e) => setSelectedSite(e.target.value)}
              className="px-3 py-1.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">All sites</option>
              {allSites.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {summary.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
                <Icon className="w-4 h-4" />
              </div>
            </div>
            <p className="text-3xl font-bold text-gray-900 dark:text-white">{value}</p>
          </div>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 py-16 text-center">
          <div className="w-12 h-12 mx-auto mb-3 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center">
            <BarChart3 className="w-6 h-6 text-gray-400 dark:text-gray-500" />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {rows.length === 0 ? 'No AI usage recorded yet.' : 'No usage matches these filters.'}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Spend by task type */}
          <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="font-semibold text-gray-900 dark:text-white">Spend by task type</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Where the money is going, split across the pipeline stages.</p>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-gray-100 dark:divide-gray-700">
              {STEPS.map((step) => {
                const s = spendByStep[step]
                const share = totalCost > 0 ? (s.cost / totalCost) * 100 : 0
                return (
                  <div key={step} className="px-6 py-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400">{STEP_LABELS[step]}</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{money(s.cost)}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      {s.uses.toLocaleString()} uses · {share.toFixed(1)}%
                    </p>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Spend by model */}
          <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="font-semibold text-gray-900 dark:text-white">Spend by model</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Every model you called, ranked by cost.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                    <th className="text-left font-medium px-6 py-3">Model</th>
                    <th className="text-right font-medium px-4 py-3">Uses</th>
                    <th className="text-right font-medium px-4 py-3">Total</th>
                    <th className="text-right font-medium px-4 py-3">Avg / use</th>
                    <th className="text-right font-medium px-6 py-3">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {spendByModel.map((m) => {
                    const share = totalCost > 0 ? (m.cost / totalCost) * 100 : 0
                    return (
                      <tr key={m.model}>
                        <td className="px-6 py-3 font-mono text-xs text-gray-700 dark:text-gray-300 truncate max-w-[320px]" title={m.model}>{m.model}</td>
                        <td className="px-4 py-3 text-right text-gray-900 dark:text-white">{m.uses}</td>
                        <td className="px-4 py-3 text-right text-gray-900 dark:text-white">{money(m.cost)}</td>
                        <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{money(m.cost / m.uses)}</td>
                        <td className="px-6 py-3 text-right text-gray-500 dark:text-gray-400">{share.toFixed(1)}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* By step + model */}
          <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="font-semibold text-gray-900 dark:text-white">Models by task type</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Which model you reach for at each stage, ranked by uses.</p>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {STEPS.map((step) => {
                const models = [...byStepModel[step].values()].sort((a, b) => b.uses - a.uses)
                return (
                  <div key={step} className="px-6 py-4">
                    <div className="flex items-baseline justify-between mb-2">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{STEP_LABELS[step]}</h3>
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {models.reduce((n, m) => n + m.uses, 0)} uses
                      </span>
                    </div>
                    {models.length === 0 ? (
                      <p className="text-xs text-gray-400 dark:text-gray-500">No usage.</p>
                    ) : (
                      <div className="grid grid-cols-12 text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wide pb-2">
                        <div className="col-span-6">Model</div>
                        <div className="col-span-2 text-right">Uses</div>
                        <div className="col-span-2 text-right">Total</div>
                        <div className="col-span-2 text-right">Avg / use</div>
                      </div>
                    )}
                    {models.map((m) => (
                      <div key={m.model} className="grid grid-cols-12 py-1.5 text-sm">
                        <div className="col-span-6 font-mono text-xs text-gray-700 dark:text-gray-300 truncate" title={m.model}>{m.model}</div>
                        <div className="col-span-2 text-right text-gray-900 dark:text-white">{m.uses}</div>
                        <div className="col-span-2 text-right text-gray-900 dark:text-white">{money(m.cost)}</div>
                        <div className="col-span-2 text-right text-gray-500 dark:text-gray-400">{money(m.cost / m.uses)}</div>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </section>

          {/* By site */}
          <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="font-semibold text-gray-900 dark:text-white">Models by site</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">The model most used at each step, per site. Unattached generations are excluded.</p>
            </div>
            {sites.length === 0 ? (
              <div className="px-6 py-8 text-sm text-gray-500 dark:text-gray-400">
                No site-attached usage matches these filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                      <th className="text-left font-medium px-6 py-3">Site</th>
                      {STEPS.map((s) => (
                        <th key={s} className="text-left font-medium px-4 py-3">{STEP_LABELS[s]}</th>
                      ))}
                      <th className="text-right font-medium px-4 py-3">Uses</th>
                      <th className="text-right font-medium px-6 py-3">Spend</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {sites.map((s) => (
                      <tr key={s.siteName}>
                        <td className="px-6 py-3 text-gray-900 dark:text-white font-medium">{s.siteName}</td>
                        {STEPS.map((step) => {
                          const top = s.topByStep[step]
                          return (
                            <td key={step} className="px-4 py-3">
                              {top ? (
                                <div>
                                  <div className="font-mono text-xs text-gray-700 dark:text-gray-300 truncate max-w-[200px]" title={top.model}>{top.model}</div>
                                  <div className="text-xs text-gray-400 dark:text-gray-500">{top.uses}×</div>
                                </div>
                              ) : (
                                <span className="text-gray-300 dark:text-gray-600">—</span>
                              )}
                            </td>
                          )
                        })}
                        <td className="px-4 py-3 text-right text-gray-900 dark:text-white">{s.uses}</td>
                        <td className="px-6 py-3 text-right text-gray-900 dark:text-white">{money(s.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Combos */}
          <section className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="font-semibold text-gray-900 dark:text-white">Pipeline combos</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">The idea + article + image models used together, ranked by how many articles ran that combination.</p>
            </div>
            {comboList.length === 0 ? (
              <div className="px-6 py-8 text-sm text-gray-500 dark:text-gray-400">
                No completed article pipelines match these filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                      {COMBO_STEPS.map((s) => (
                        <th key={s} className="text-left font-medium px-6 py-3">{STEP_LABELS[s]}</th>
                      ))}
                      <th className="text-right font-medium px-4 py-3">Articles</th>
                      <th className="text-right font-medium px-4 py-3">Total</th>
                      <th className="text-right font-medium px-6 py-3">Avg / article</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {comboList.map((c) => (
                      <tr key={c.key}>
                        {COMBO_STEPS.map((step) => {
                          const model = step === 'idea' ? c.idea : step === 'article' ? c.article : c.image
                          return (
                            <td key={step} className="px-6 py-3">
                              {model ? (
                                <span className="font-mono text-xs text-gray-700 dark:text-gray-300" title={model}>{model}</span>
                              ) : (
                                <span className="text-gray-300 dark:text-gray-600">—</span>
                              )}
                            </td>
                          )
                        })}
                        <td className="px-4 py-3 text-right text-gray-900 dark:text-white">{c.articles}</td>
                        <td className="px-4 py-3 text-right text-gray-900 dark:text-white">{money(c.cost)}</td>
                        <td className="px-6 py-3 text-right text-gray-500 dark:text-gray-400">{money(c.cost / c.articles)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
