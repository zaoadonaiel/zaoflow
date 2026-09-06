'use client'

import { useState, useEffect, useCallback } from 'react'
import { Link2, Plus, Copy, Trash2, Loader2, RefreshCw, Eye, EyeOff, User, ChevronDown, ChevronUp, KeyRound } from 'lucide-react'
import Header from '@/components/layout/Header'
import Modal from '@/components/ui/Modal'
import type { ClientPortal, Site } from '@/types'
import { MAX_CODE_ATTEMPTS } from '@/lib/portal'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

export default function ClientsPage() {
  const [portals, setPortals] = useState<ClientPortal[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ site_id: '', client_name: '' })
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [opensFor, setOpensFor] = useState<string | null>(null)
  const [opens, setOpens] = useState<Record<string, { id: string; opened_at: string }[]>>({})
  const [loadingOpens, setLoadingOpens] = useState(false)

  async function toggleOpens(id: string) {
    if (opensFor === id) { setOpensFor(null); return }
    setOpensFor(id)
    if (opens[id]) return
    setLoadingOpens(true)
    try {
      const res = await fetch(`/api/portals/${id}/opens`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load open history')
      setOpens((prev) => ({ ...prev, [id]: data.opens || [] }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load open history')
      setOpensFor(null)
    } finally {
      setLoadingOpens(false)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/portals')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load client links')
      setPortals(data.portals || [])
      setLoadError(null)
    } catch (err) {
      setPortals([])
      setLoadError(err instanceof Error ? err.message : 'Could not load client links')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    fetch('/api/sites').then((r) => r.json()).then((d) => {
      const list: Site[] = d.sites || []
      setSites(list)
      if (list.length) setForm((f) => ({ ...f, site_id: f.site_id || list[0].id }))
    }).catch(() => {})
  }, [])

  function urlFor(p: ClientPortal) {
    const base = typeof window !== 'undefined' ? window.location.origin : ''
    return `${base}/p/${p.token}`
  }

  async function copy(p: ClientPortal) {
    try {
      await navigator.clipboard.writeText(urlFor(p))
      toast.success('Link copied')
    } catch {
      toast.error('Could not copy — select and copy it manually')
    }
  }

  async function copyCode(p: ClientPortal) {
    try {
      await navigator.clipboard.writeText(p.access_code)
      toast.success('Code copied')
    } catch {
      toast.error('Could not copy — select and copy it manually')
    }
  }

  async function create() {
    if (!form.site_id) { toast.error('Pick a site'); return }
    setCreating(true)
    try {
      const res = await fetch('/api/portals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not create the link')
      toast.success('Client link created')
      setShowCreate(false)
      setForm((f) => ({ ...f, client_name: '' }))
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the link')
    } finally {
      setCreating(false)
    }
  }

  async function patch(id: string, body: Record<string, unknown>, msg: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/portals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not update')
      toast.success(msg)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(p: ClientPortal) {
    if (!confirm(`Delete the link for ${p.client_name || p.sites?.name}? Their comment history is deleted with it.`)) return
    setBusyId(p.id)
    try {
      const res = await fetch(`/api/portals/${p.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      toast.success('Link deleted')
      await load()
    } catch {
      toast.error('Could not delete the link')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <Header
        title="Client Links"
        subtitle="Share a review link so clients can read and comment on their queued articles"
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-brand-600 text-white px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 whitespace-nowrap flex-shrink-0"
          >
            <Plus className="w-4 h-4" /> New link
          </button>
        }
      />

      <div className="p-4 sm:p-6 max-w-4xl">
        <div className="rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 px-4 py-3 mb-5">
          <p className="text-xs text-amber-800 dark:text-amber-300">
            Each link needs its own 5-digit access code, shown below and nowhere else. Send
            the link and the code to your client separately — the link on its own opens
            nothing. Three wrong codes lock a link until you issue a new one, which is also
            how you cut off a code that got out.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
        ) : loadError ? (
          <div className="rounded-2xl border border-red-200 dark:border-red-900/40 bg-red-50/50 dark:bg-red-900/10 py-12 text-center px-6">
            <p className="text-sm font-medium text-gray-900 dark:text-white">Could not load client links</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{loadError}</p>
            <button onClick={load} className="mt-4 bg-brand-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-brand-700">
              Try again
            </button>
          </div>
        ) : !portals.length ? (
          <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 py-16 text-center">
            <Link2 className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-500 dark:text-gray-400">No client links yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {portals.map((p) => {
              const locked = (p.failed_attempts ?? 0) >= MAX_CODE_ATTEMPTS
              return (
              <div
                key={p.id}
                className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 sm:p-5"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900 dark:text-white truncate">
                      {p.sites?.name || 'Unknown site'}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1.5 truncate">
                      <User className="w-3 h-3 flex-shrink-0" /> {p.client_name || 'Unnamed client'}
                    </p>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium flex-shrink-0 ${
                    p.is_active
                      ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                      : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                  }`}>
                    {p.is_active ? 'Active' : 'Disabled'}
                  </span>
                </div>

                <div className="flex items-center gap-2 rounded-xl bg-gray-50 dark:bg-gray-900/50 px-3 py-2.5 mb-2">
                  <code className="text-xs text-gray-600 dark:text-gray-300 truncate flex-1 min-w-0">{urlFor(p)}</code>
                  <button
                    onClick={() => copy(p)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-white dark:hover:bg-gray-700 flex-shrink-0"
                    title="Copy link"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>

                {/* Access code — the "Locked" warning was inline with the code
                    on desktop, which overflowed on a phone. Broken onto its
                    own line under the code so a locked link still reads as one
                    tidy row. */}
                <div className="rounded-xl bg-gray-50 dark:bg-gray-900/50 px-3 py-2.5 mb-3">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    <span className="text-xs text-gray-400 flex-shrink-0">Access code</span>
                    <code className="text-sm font-semibold tracking-[0.2em] text-gray-900 dark:text-white flex-1 min-w-0 truncate">
                      {p.access_code || '—'}
                    </code>
                    <button
                      onClick={() => copyCode(p)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-brand-600 hover:bg-white dark:hover:bg-gray-700 flex-shrink-0"
                      title="Copy code"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                  {locked && (
                    <p className="text-[11px] font-medium text-red-600 dark:text-red-400 mt-1.5">
                      Locked — issue a new code
                    </p>
                  )}
                </div>

                <button
                  onClick={() => toggleOpens(p.id)}
                  className="w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 mb-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40"
                >
                  <span className="text-xs text-gray-600 dark:text-gray-300 min-w-0 truncate">
                    Opened <strong className="font-semibold text-gray-900 dark:text-white">{p.open_count ?? 0}</strong>
                    {(p.open_count ?? 0) === 1 ? ' time' : ' times'}
                    {p.last_viewed_at && (
                      <span className="text-gray-400"> · last {format(new Date(p.last_viewed_at), 'MMM d, yyyy h:mm a')}</span>
                    )}
                  </span>
                  {opensFor === p.id
                    ? <ChevronUp className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    : <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />}
                </button>

                {opensFor === p.id && (
                  <div className="mb-3 rounded-lg border border-gray-100 dark:border-gray-700 max-h-56 overflow-y-auto">
                    {loadingOpens && !opens[p.id] ? (
                      <div className="py-6 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-gray-400" /></div>
                    ) : !opens[p.id]?.length ? (
                      <p className="py-6 text-center text-xs text-gray-400">
                        This link hasn&apos;t been opened yet.
                      </p>
                    ) : (
                      <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                        {opens[p.id].map((o, i) => (
                          <li key={o.id} className="flex items-center justify-between px-3 py-2">
                            <span className="text-xs text-gray-400">#{opens[p.id].length - i}</span>
                            <span className="text-xs text-gray-700 dark:text-gray-300 font-mono">
                              {format(new Date(o.opened_at), 'MM/dd/yyyy h:mm a')}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Action row — pipe separators + four text buttons overflowed
                    the card on mobile, pushing Delete visually outside its
                    rounded border. Padded pill buttons that wrap cleanly and
                    keep Delete inside the card with ml-auto. */}
                <div className="flex flex-wrap items-center gap-1 border-t border-gray-100 dark:border-gray-700 pt-3 -mx-1">
                  <button
                    onClick={() => patch(p.id, { is_active: !p.is_active }, p.is_active ? 'Link disabled' : 'Link enabled')}
                    disabled={busyId === p.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-40"
                  >
                    {p.is_active ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {p.is_active ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('Issue a new URL? The current link stops working immediately.')) {
                        patch(p.id, { rotate: true }, 'New link issued')
                      }
                    }}
                    disabled={busyId === p.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-40"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Rotate
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('Issue a new access code? The current one stops working immediately, anyone reading right now is asked for the new one, and a locked link is opened up again.')) {
                        patch(p.id, { new_code: true }, 'New access code issued')
                      }
                    }}
                    disabled={busyId === p.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-40"
                  >
                    <KeyRound className="w-3.5 h-3.5" /> New code
                  </button>
                  <button
                    onClick={() => remove(p)}
                    disabled={busyId === p.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-40 ml-auto"
                    title="Delete link"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  {busyId === p.id && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400 ml-1" />}
                </div>
              </div>
              )
            })}
          </div>
        )}
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New client link">
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Site</label>
        <select
          value={form.site_id}
          onChange={(e) => setForm((f) => ({ ...f, site_id: e.target.value }))}
          className="w-full h-11 px-3 mb-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white"
        >
          {!sites.length && <option value="">No sites connected</option>}
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
          Client name <span className="text-gray-400">(greets them on the page)</span>
        </label>
        <input
          value={form.client_name}
          onChange={(e) => setForm((f) => ({ ...f, client_name: e.target.value }))}
          placeholder="John"
          className="w-full h-11 px-3 mb-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white"
        />

        <div className="flex gap-2">
          <button
            onClick={() => setShowCreate(false)}
            className="flex-1 h-10 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Cancel
          </button>
          <button
            onClick={create}
            disabled={creating || !form.site_id}
            className="flex-1 h-10 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-40 inline-flex items-center justify-center gap-2"
          >
            {creating && <Loader2 className="w-4 h-4 animate-spin" />}
            Create link
          </button>
        </div>
      </Modal>
    </>
  )
}
