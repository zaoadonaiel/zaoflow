'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, AlertCircle, HardDrive, Lock, Pencil } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import {
  MAX_KNOWLEDGE_BASE_CHARS,
  knowledgeBaseLimitError,
} from '@/lib/knowledge-base'
import toast from 'react-hot-toast'

interface Props {
  open: boolean
  onClose: () => void
  siteId: string
  siteName: string
  /** Fired after a successful save, with the stored text. */
  onSaved?: (knowledgeBase: string) => void
  /**
   * Opened by the pencil rather than the eye: go straight to the code gate
   * instead of making the user ask to edit a second time.
   */
  startInEdit?: boolean
}

/** A fresh code per unlock, so muscle memory can't carry over from the last edit. */
function generateEditCode(): string {
  const random = typeof crypto !== 'undefined' && crypto.getRandomValues
    ? crypto.getRandomValues(new Uint32Array(1))[0] % 100000
    : Math.floor(Math.random() * 100000)
  return String(random).padStart(5, '0')
}

/**
 * The site's knowledge base — the company behind it and the premise the AI
 * writes inside. Opens read-only: this text steers every idea and every
 * article for the site, so editing is deliberate rather than one stray click,
 * and the 5 digit code is what makes it deliberate.
 *
 * Shared by the Sites page and the article page, so both edit the same field
 * through the same gate.
 */
export default function KnowledgeBaseModal({
  open, onClose, siteId, siteName, onSaved, startInEdit = false,
}: Props) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // `stored` is what the database holds; `draft` is the textarea.
  const [stored, setStored] = useState('')
  const [draft, setDraft] = useState('')
  // The column is not there yet — writing anything here would fail on save.
  const [migrationRequired, setMigrationRequired] = useState(false)

  // Empty until the user asks to edit — its presence is what "locked" means.
  const [editCode, setEditCode] = useState('')
  const [codeInput, setCodeInput] = useState('')
  const [unlocked, setUnlocked] = useState(false)

  const limitError = knowledgeBaseLimitError(draft)
  const dirty = draft.trim() !== stored.trim()

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(`/api/sites/${siteId}/knowledge`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load the knowledge base')
      setStored(data.knowledge_base || '')
      setDraft(data.knowledge_base || '')
      setMigrationRequired(Boolean(data.migration_required))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load the knowledge base'
      // Surfaced inline: an empty box here is indistinguishable from "nothing
      // written yet", which would hide a failed read behind a blank page.
      setLoadError(message)
    } finally {
      setLoading(false)
    }
  }, [siteId])

  // Reset the gate every time the modal opens, so a previous unlock never
  // carries into a new session with the field.
  useEffect(() => {
    if (!open) return
    setEditCode(startInEdit ? generateEditCode() : '')
    setCodeInput('')
    setUnlocked(false)
    load()
  }, [open, load, startInEdit])

  function requestEdit() {
    setEditCode(generateEditCode())
    setCodeInput('')
  }

  function handleCodeInput(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 5)
    setCodeInput(digits)
    if (digits === editCode) setUnlocked(true)
  }

  async function handleSave() {
    if (limitError) { toast.error(limitError); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/sites/${siteId}/knowledge`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ knowledge_base: draft.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      setStored(data.knowledge_base || '')
      setDraft(data.knowledge_base || '')
      onSaved?.(data.knowledge_base || '')
      toast.success('Knowledge base saved')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function handleClose() {
    if (saving) return
    if (unlocked && dirty && !confirm('Close without saving your knowledge base changes?')) return
    onClose()
  }

  const codeMismatch = codeInput.length === 5 && codeInput !== editCode

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`Knowledge base — ${siteName}`}
      maxWidth="max-w-2xl"
    >
      <div className="space-y-4">
        <p className="flex items-start gap-2 text-sm text-gray-500 dark:text-gray-400">
          <HardDrive className="w-4 h-4 mt-0.5 flex-shrink-0 text-gray-400" />
          <span>
            What the company is and what everything written for this site is about. The
            AI reads this first, every time it generates an idea or an article for{' '}
            <span className="font-medium text-gray-700 dark:text-gray-300">{siteName}</span>.
          </span>
        </p>

        {loading ? (
          <div className="flex items-center gap-2 py-10 justify-center text-sm text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading…
          </div>
        ) : loadError ? (
          <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400 py-6">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              {loadError}{' '}
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
            {migrationRequired && (
              <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-xl px-3 py-2.5">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>
                  This database has not run migration{' '}
                  <code className="font-mono">015_site_knowledge_base.sql</code> yet, so there is
                  nowhere to save a knowledge base. Run it against Supabase and reopen this.
                </span>
              </p>
            )}

            <div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                readOnly={!unlocked}
                rows={12}
                placeholder={
                  unlocked
                    ? 'Acme Roofing is a family-run roofing contractor in Phoenix, Arizona, serving homeowners since 1998…\n\nEverything written for this site is aimed at homeowners deciding whether to repair or replace a roof.'
                    : 'Nothing written yet — unlock below to add it.'
                }
                aria-label="Knowledge base"
                className={`w-full px-4 py-2.5 border rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent resize-y ${
                  unlocked
                    ? 'bg-gray-50 dark:bg-gray-700'
                    : 'bg-gray-100/70 dark:bg-gray-900/40 cursor-default'
                } ${
                  limitError
                    ? 'border-red-300 dark:border-red-800 focus:ring-red-500'
                    : 'border-gray-200 dark:border-gray-600 focus:ring-brand-500'
                }`}
              />
              {limitError ? (
                <p className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400 mt-1.5">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                  {limitError}
                </p>
              ) : (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
                  {draft.trim().length.toLocaleString()} /{' '}
                  {MAX_KNOWLEDGE_BASE_CHARS.toLocaleString()} characters
                </p>
              )}
            </div>

            {!unlocked ? (
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-4">
                {!editCode ? (
                  <div className="flex items-center justify-between gap-4">
                    <p className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <Lock className="w-4 h-4 text-gray-400" />
                      {migrationRequired
                        ? 'Unavailable until the migration has run.'
                        : 'Locked — this steers every article on the site.'}
                    </p>
                    <button
                      type="button"
                      onClick={requestEdit}
                      disabled={migrationRequired}
                      title="Edit knowledge base"
                      aria-label="Edit knowledge base"
                      className="flex items-center justify-center w-9 h-9 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-brand-600 dark:hover:text-brand-400 transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      To edit this, type in this 5 digit code
                    </label>
                    <div className="flex items-center gap-3">
                      <span
                        aria-label={`Confirmation code ${editCode.split('').join(' ')}`}
                        className="select-none font-mono font-semibold tracking-[0.3em] text-lg text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-2.5"
                      >
                        {editCode}
                      </span>
                      <input
                        type="text"
                        value={codeInput}
                        onChange={(e) => handleCodeInput(e.target.value)}
                        inputMode="numeric"
                        autoComplete="off"
                        autoFocus
                        placeholder="–––––"
                        aria-label="Type the confirmation code"
                        className="flex-1 min-w-0 px-4 py-2.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-lg font-mono tracking-[0.3em] text-gray-900 dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                      />
                    </div>
                    {codeMismatch && (
                      <p className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400 mt-1.5">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                        That code doesn&apos;t match. Type {editCode} to unlock.
                      </p>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={saving}
                  className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !dirty || Boolean(limitError)}
                  className="flex-1 flex items-center justify-center gap-2 bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
                >
                  {saving ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</> : 'Save knowledge base'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
