'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  Layers,
  Loader2,
  MapPin,
  Play,
  Rocket,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'

import ModelSelect from '@/components/ui/ModelSelect'
import InstructionSets from '@/components/articles/InstructionSets'
import type { ArticleInstruction, Site, WPPageOption } from '@/types'

interface CityList {
  id: string
  name: string
  source_filename: string | null
  city_count: number
  ai_model: string | null
  created_at: string
}

interface RunItem {
  id: string
  position: number
  target_city: string
  status: 'pending' | 'running' | 'published' | 'failed' | 'skipped'
  error: string | null
  wp_page_url: string | null
  seo_page_id: string | null
  started_at: string | null
  completed_at: string | null
}

interface RunHeader {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  total: number
  succeeded: number
  failed: number
  error: string | null
}

const SIMILARITY_BUTTONS = [10, 25, 50, 90] as const
type Similarity = (typeof SIMILARITY_BUTTONS)[number]

/**
 * Auto Post — bulk clone/publish an SEO page across every city in a saved
 * list. Two subsections that fold up when unused:
 *   1. Build a city list (upload .docx → AI extracts → CSV in library)
 *   2. Run a batch (pick list + source page + model → Trigger.dev processes
 *      every city and publishes to WordPress)
 *
 * The card starts collapsed so it doesn't dominate the SEO Pages list for
 * users who aren't running batches. Progress panel appears once a run is
 * active and polls until it finishes.
 */
export default function AutoPostCard() {
  const [expanded, setExpanded] = useState(false)

  // Library state
  const [cityLists, setCityLists] = useState<CityList[]>([])
  const [libraryLoading, setLibraryLoading] = useState(true)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadName, setUploadName] = useState('')
  const [extractModel, setExtractModel] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Run config state
  const [sites, setSites] = useState<Site[]>([])
  const [selectedListId, setSelectedListId] = useState('')
  const [siteId, setSiteId] = useState('')
  const [sourceKind, setSourceKind] = useState<'post' | 'page'>('page')
  const [wpPages, setWpPages] = useState<WPPageOption[]>([])
  const [wpPagesLoading, setWpPagesLoading] = useState(false)
  const [sourcePageId, setSourcePageId] = useState<number | null>(null)
  const [sourceCity, setSourceCity] = useState('')
  const [runModel, setRunModel] = useState('')
  const [similarity, setSimilarity] = useState<Similarity | null>(50)
  const [instructionId, setInstructionId] = useState<string | null>(null)
  const [cityOnlyMode, setCityOnlyMode] = useState(false)
  const [overrideExisting, setOverrideExisting] = useState(true)
  const [setLocationMeta, setSetLocationMeta] = useState(true)
  const [starting, setStarting] = useState(false)

  // Progress state
  const [runId, setRunId] = useState<string | null>(null)
  const [runHeader, setRunHeader] = useState<RunHeader | null>(null)
  const [runItems, setRunItems] = useState<RunItem[]>([])

  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true)
    try {
      const res = await fetch('/api/seo-pages/city-lists')
      const data = await res.json()
      if (res.ok) setCityLists((data.cityLists || []) as CityList[])
    } finally {
      setLibraryLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!expanded) return
    loadLibrary()
    fetch('/api/sites')
      .then((r) => r.json())
      .then((d) => setSites((d.sites || []).filter((s: Site) => s.site_type === 'wordpress')))
      .catch(() => {})
  }, [expanded, loadLibrary])

  useEffect(() => {
    if (!siteId) { setWpPages([]); return }
    let cancelled = false
    setWpPagesLoading(true)
    fetch(`/api/seo-pages/wp-pages?site_id=${siteId}&kind=${sourceKind}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (cancelled) return
        if (ok) setWpPages((d.pages || []) as WPPageOption[])
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setWpPagesLoading(false) })
    return () => { cancelled = true }
  }, [siteId, sourceKind])

  // Poll the active run every 2s until it terminates. Slow polling on
  // purpose — a 30-city run takes minutes, this doesn't need to be tight.
  useEffect(() => {
    if (!runId) return
    let cancelled = false
    const tick = async () => {
      try {
        const res = await fetch(`/api/seo-pages/auto-post/runs/${runId}`)
        const data = await res.json()
        if (cancelled) return
        if (res.ok) {
          setRunHeader(data.run)
          setRunItems(data.items || [])
        }
      } catch { /* transient, next tick will retry */ }
    }
    tick()
    const id = setInterval(() => {
      if (!runHeader || runHeader.status === 'running' || runHeader.status === 'queued') {
        tick()
      }
    }, 2000)
    return () => { cancelled = true; clearInterval(id) }
  }, [runId, runHeader])

  const selectedList = useMemo(
    () => cityLists.find((l) => l.id === selectedListId) ?? null,
    [cityLists, selectedListId],
  )

  async function handleExtract() {
    if (!uploadFile) { toast.error('Pick a .docx file'); return }
    if (!extractModel) { toast.error('Pick an AI model'); return }
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', uploadFile)
      form.append('model', extractModel)
      if (uploadName.trim()) form.append('name', uploadName.trim())
      const res = await fetch('/api/seo-pages/city-lists', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Extraction failed')
      toast.success(`Extracted ${data.cityList.city_count} cities`)
      setUploadFile(null)
      setUploadName('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      await loadLibrary()
      setSelectedListId(data.cityList.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Extraction failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleDeleteList(list: CityList) {
    if (!confirm(`Delete city list "${list.name}"?`)) return
    try {
      const res = await fetch(`/api/seo-pages/city-lists/${list.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      setCityLists((prev) => prev.filter((l) => l.id !== list.id))
      if (selectedListId === list.id) setSelectedListId('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const canRun = Boolean(
    selectedListId &&
    siteId &&
    sourcePageId &&
    sourceCity.trim() &&
    (cityOnlyMode || (runModel && similarity)),
  )

  async function handleRun() {
    if (!canRun) return
    setStarting(true)
    try {
      const res = await fetch('/api/seo-pages/auto-post/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city_list_id: selectedListId,
          site_id: siteId,
          source_kind: sourceKind,
          source_page_id: sourcePageId,
          source_city: sourceCity.trim(),
          ai_model: cityOnlyMode ? null : runModel,
          rewrite_similarity: cityOnlyMode ? null : similarity,
          instruction_id: cityOnlyMode ? null : instructionId,
          city_only_mode: cityOnlyMode,
          override_existing: overrideExisting,
          set_location_meta: setLocationMeta,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to start run')
      setRunId(data.runId)
      setRunHeader({ id: data.runId, status: 'queued', total: data.total, succeeded: 0, failed: 0, error: null })
      setRunItems([])
      toast.success(`Queued ${data.total} cities`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start run')
    } finally {
      setStarting(false)
    }
  }

  const isRunning = runHeader && (runHeader.status === 'queued' || runHeader.status === 'running')
  const doneCount = (runHeader?.succeeded ?? 0) + (runHeader?.failed ?? 0)
  const progressPct = runHeader && runHeader.total > 0
    ? Math.round((doneCount / runHeader.total) * 100)
    : 0

  return (
    <div className="bg-gradient-to-br from-brand-50 to-white dark:from-brand-950/30 dark:to-gray-800 rounded-2xl border border-brand-200 dark:border-brand-900/40 mb-6 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-600 text-white flex items-center justify-center">
            <Rocket className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              Auto Post
              {isRunning && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-400">
                  <Loader2 className="w-3 h-3 animate-spin" /> Running
                </span>
              )}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Upload a Word doc, extract cities, and bulk-publish an SEO page for every one.
            </p>
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="w-5 h-5 text-gray-400" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-400" />
        )}
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-5 border-t border-brand-200 dark:border-brand-900/40 pt-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                <FileText className="w-4 h-4 text-brand-500" />
                1 · Build a city list
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Word doc (.docx)</label>
                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-700 dark:text-gray-200 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600">
                    <Upload className="w-4 h-4" />
                    <span className="truncate max-w-[200px]">{uploadFile ? uploadFile.name : 'Choose file'}</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".docx"
                      onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                      className="hidden"
                    />
                  </label>
                  {uploadFile && (
                    <button
                      type="button"
                      onClick={() => {
                        setUploadFile(null)
                        if (fileInputRef.current) fileInputRef.current.value = ''
                      }}
                      className="p-2 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                      aria-label="Clear file"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">List name (optional)</label>
                <input
                  type="text"
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                  placeholder={uploadFile ? uploadFile.name.replace(/\.docx$/i, '') : 'e.g. Bay Area cities'}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">AI model (extraction)</label>
                <ModelSelect value={extractModel} onChange={setExtractModel} variant="compact" />
              </div>

              <button
                type="button"
                onClick={handleExtract}
                disabled={!uploadFile || !extractModel || uploading}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
              >
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Extract cities → CSV
              </button>

              <div className="pt-3 border-t border-gray-100 dark:border-gray-700 space-y-2">
                <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Library {libraryLoading ? '…' : `(${cityLists.length})`}
                </p>
                {cityLists.length === 0 && !libraryLoading ? (
                  <p className="text-xs text-gray-400">No saved lists yet.</p>
                ) : (
                  <ul className="space-y-1 max-h-40 overflow-y-auto">
                    {cityLists.map((list) => (
                      <li
                        key={list.id}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                          selectedListId === list.id
                            ? 'bg-brand-50 dark:bg-brand-900/30 border border-brand-200 dark:border-brand-800'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                        onClick={() => setSelectedListId(list.id)}
                      >
                        <Layers className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                        <span className="flex-1 truncate text-gray-800 dark:text-gray-100">{list.name}</span>
                        <span className="text-gray-400 shrink-0">{list.city_count}</span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleDeleteList(list) }}
                          className="p-1 text-gray-400 hover:text-red-600 rounded"
                          aria-label={`Delete ${list.name}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                <MapPin className="w-4 h-4 text-brand-500" />
                2 · Run a batch
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">City list</label>
                <select
                  value={selectedListId}
                  onChange={(e) => setSelectedListId(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">{cityLists.length === 0 ? 'Extract a list first' : 'Pick a list'}</option>
                  {cityLists.map((l) => (
                    <option key={l.id} value={l.id}>{l.name} ({l.city_count})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Site</label>
                  <select
                    value={siteId}
                    onChange={(e) => { setSiteId(e.target.value); setSourcePageId(null) }}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="">Pick a WP site</option>
                    {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Source type</label>
                  <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-700 p-1 w-full">
                    {(['page', 'post'] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => { setSourceKind(k); setSourcePageId(null) }}
                        className={`flex-1 px-2 py-1 text-xs font-medium rounded-md capitalize transition-colors ${
                          sourceKind === k
                            ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm'
                            : 'text-gray-500 dark:text-gray-400'
                        }`}
                      >
                        {k}s
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Source {sourceKind} to clone
                  {wpPagesLoading && <Loader2 className="inline w-3 h-3 animate-spin ml-2" />}
                </label>
                <select
                  value={sourcePageId ?? ''}
                  onChange={(e) => setSourcePageId(e.target.value ? Number(e.target.value) : null)}
                  disabled={!siteId || wpPagesLoading}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
                >
                  <option value="">
                    {!siteId ? 'Pick a site first' : wpPagesLoading ? `Loading ${sourceKind}s…` : `Pick a ${sourceKind}`}
                  </option>
                  {wpPages.map((p) => <option key={p.id} value={p.id}>{p.title} · /{p.slug}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Source city</label>
                <input
                  type="text"
                  value={sourceCity}
                  onChange={(e) => setSourceCity(e.target.value)}
                  placeholder="Los Angeles CA"
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cityOnlyMode}
                  onChange={(e) => setCityOnlyMode(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500"
                />
                <span>Only city name (skip AI rewrite — free, no drift)</span>
              </label>

              {!cityOnlyMode && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Rewrite model</label>
                    <ModelSelect value={runModel} onChange={setRunModel} variant="compact" />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Similarity</label>
                    <div className="grid grid-cols-4 gap-1">
                      {SIMILARITY_BUTTONS.map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setSimilarity(v)}
                          className={`py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                            similarity === v
                              ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-400'
                              : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-brand-300'
                          }`}
                        >
                          {v}%
                        </button>
                      ))}
                    </div>
                  </div>

                  <InstructionSets
                    selectedId={instructionId}
                    onSelect={(set: ArticleInstruction) => setInstructionId(set.id)}
                    autoSelectDefault
                  />
                </>
              )}

              <div className="grid grid-cols-1 gap-2 pt-1 border-t border-gray-100 dark:border-gray-700">
                <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={overrideExisting}
                    onChange={(e) => setOverrideExisting(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500"
                  />
                  Override existing WP pages at the same slug
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={setLocationMeta}
                    onChange={(e) => setSetLocationMeta(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-brand-600 focus:ring-brand-500"
                  />
                  Tick the “Location” meta on each page
                </label>
              </div>

              <button
                type="button"
                onClick={handleRun}
                disabled={!canRun || starting || Boolean(isRunning)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
              >
                {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Run on {selectedList?.city_count ?? '?'} cities
              </button>
            </section>
          </div>

          {runHeader && (
            <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                  <Rocket className="w-4 h-4 text-brand-500" />
                  Progress
                  <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                    {runHeader.status}
                  </span>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">{runHeader.succeeded}</span>
                  {' · '}
                  <span className="text-red-600 dark:text-red-400 font-medium">{runHeader.failed}</span>
                  {' / '}
                  <span>{runHeader.total}</span>
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden mb-3">
                <div
                  className="h-full bg-brand-500 transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              {runHeader.error && (
                <p className="text-xs text-red-600 dark:text-red-400 mb-2">{runHeader.error}</p>
              )}
              <ul className="space-y-1 max-h-64 overflow-y-auto pr-1">
                {runItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs bg-gray-50 dark:bg-gray-900/40"
                  >
                    <StatusDot status={item.status} />
                    <span className="flex-1 truncate text-gray-800 dark:text-gray-100">{item.target_city}</span>
                    {item.wp_page_url && (
                      <a
                        href={item.wp_page_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-brand-600 dark:text-brand-400 hover:underline"
                      >
                        View <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    {item.error && (
                      <span className="text-red-600 dark:text-red-400 truncate max-w-[240px]" title={item.error}>
                        {item.error}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function StatusDot({ status }: { status: RunItem['status'] }) {
  const cls: Record<RunItem['status'], string> = {
    pending: 'bg-gray-300 dark:bg-gray-600',
    running: 'bg-brand-500 animate-pulse',
    published: 'bg-emerald-500',
    failed: 'bg-red-500',
    skipped: 'bg-yellow-500',
  }
  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cls[status]}`} />
}
