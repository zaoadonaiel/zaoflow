'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Pencil, Trash2, Loader2, BookOpen, AlertCircle } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { MAX_ARTICLE_WORDS, wordCountLimitError } from '@/lib/instruction-limits'
import type { ArticleInstruction } from '@/types'
import toast from 'react-hot-toast'

interface InstructionSetsProps {
  /** id of the set currently applied to the article, or null */
  selectedId: string | null
  /** fired when a card body is clicked — parent applies set.instructions */
  onSelect: (set: ArticleInstruction) => void
  /**
   * When true and nothing is selected yet, pick the first available set once
   * the list loads. Meant for the new-article page so the first save has a
   * concrete instruction set attached rather than shipping with none.
   */
  autoSelectDefault?: boolean
}

export default function InstructionSets({ selectedId, onSelect, autoSelectDefault = false }: InstructionSetsProps) {
  const [sets, setSets] = useState<ArticleInstruction[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Form modal — `editing` holds the set being edited, or null when creating
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ArticleInstruction | null>(null)
  const [name, setName] = useState('')
  const [instructions, setInstructions] = useState('')
  const [saving, setSaving] = useState(false)

  // Delete modal — `deleteTarget` holds the set awaiting confirmation
  const [deleteTarget, setDeleteTarget] = useState<ArticleInstruction | null>(null)
  const [deleteCode, setDeleteCode] = useState('')
  const [codeInput, setCodeInput] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Live check so the cap is visible while typing, not only on save
  const limitError = wordCountLimitError(instructions)
  const codeMatches = codeInput === deleteCode

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch('/api/instructions')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load instructions')
      setSets(data.instructions || [])
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load instructions'
      // Surface the failure inline — an empty list here is indistinguishable
      // from "you have none yet", which hides things like a missing table
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Fires at most once per mount, so a user who deliberately clears the
  // selection back to null doesn't have it snap right back to the first set.
  const autoSelectedRef = useRef(false)
  useEffect(() => {
    if (
      autoSelectDefault &&
      !autoSelectedRef.current &&
      !loading &&
      !selectedId &&
      sets.length > 0
    ) {
      autoSelectedRef.current = true
      onSelect(sets[0])
    }
  }, [autoSelectDefault, loading, selectedId, sets, onSelect])

  function openCreate() {
    setEditing(null)
    setName('')
    setInstructions('')
    setFormOpen(true)
  }

  function openEdit(set: ArticleInstruction) {
    setEditing(set)
    setName(set.name)
    setInstructions(set.instructions)
    setFormOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { toast.error('Give this instruction set a name'); return }
    if (!instructions.trim()) { toast.error('Add some instructions'); return }
    if (limitError) { toast.error(limitError); return }

    setSaving(true)
    try {
      const res = await fetch(
        editing ? `/api/instructions/${editing.id}` : '/api/instructions',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), instructions: instructions.trim() }),
        }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')

      const saved: ArticleInstruction = data.instruction
      setSets((prev) =>
        editing ? prev.map((s) => (s.id === saved.id ? saved : s)) : [...prev, saved]
      )
      // Keep the editor and the textarea in sync when the active set is edited
      if (editing && selectedId === saved.id) onSelect(saved)

      toast.success(editing ? 'Instruction set updated' : 'Instruction set saved')
      setFormOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // A fresh code per attempt, so muscle memory can't carry over from the last delete
  function generateDeleteCode() {
    const random = typeof crypto !== 'undefined' && crypto.getRandomValues
      ? crypto.getRandomValues(new Uint32Array(1))[0] % 10000
      : Math.floor(Math.random() * 10000)
    return String(random).padStart(4, '0')
  }

  function openDelete(set: ArticleInstruction) {
    setDeleteTarget(set)
    setDeleteCode(generateDeleteCode())
    setCodeInput('')
  }

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault()
    if (!deleteTarget || !codeMatches) return

    setDeleting(true)
    try {
      const res = await fetch(`/api/instructions/${deleteTarget.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Delete failed')
      setSets((prev) => prev.filter((s) => s.id !== deleteTarget.id))
      toast.success('Instruction set deleted')
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
        <span className="text-xs text-gray-400 dark:text-gray-500 mr-1 flex items-center gap-1">
          <BookOpen className="w-3.5 h-3.5" />
          Saved instructions:
        </span>

        {loading ? (
          <span className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-gray-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            Loading…
          </span>
        ) : loadError ? (
          <span className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {loadError}
            <button
              type="button"
              onClick={load}
              className="underline underline-offset-2 hover:text-red-700 dark:hover:text-red-300"
            >
              Retry
            </button>
          </span>
        ) : sets.length === 0 ? (
          <span className="text-xs text-gray-400 dark:text-gray-500 italic">
            None yet — save your first reusable instruction set
          </span>
        ) : (
          sets.map((set) => {
            const active = selectedId === set.id
            return (
              <div
                key={set.id}
                className={`group flex items-center rounded-lg border transition-colors ${
                  active
                    ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-700'
                    : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(set)}
                  title={set.instructions}
                  className={`pl-2.5 pr-1 py-1 rounded-l-lg text-xs font-medium transition-colors max-w-[14rem] truncate ${
                    active
                      ? 'text-brand-700 dark:text-brand-400'
                      : 'text-gray-500 dark:text-gray-400 group-hover:text-gray-700 dark:group-hover:text-gray-200'
                  }`}
                >
                  {set.name}
                </button>

                {/* Revealed on hover / keyboard focus; space is reserved so the row never shifts */}
                <span className="flex items-center gap-0.5 pr-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => openEdit(set)}
                    aria-label={`Edit ${set.name}`}
                    title="Edit"
                    className="p-1 rounded text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-white/70 dark:hover:bg-gray-600 transition-colors"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => openDelete(set)}
                    aria-label={`Delete ${set.name}`}
                    title="Delete"
                    className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-white/70 dark:hover:bg-gray-600 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </span>
              </div>
            )
          })
        )}

        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
        >
          <Plus className="w-3 h-3" />
          New instruction
        </button>
      </div>

      <Modal
        open={formOpen}
        onClose={() => !saving && setFormOpen(false)}
        title={editing ? 'Edit instruction set' : 'New instruction set'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Standard Blog Post"
              autoFocus
              className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Instructions
            </label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={'The article must be 800 words, have exactly 3 H2s, and 2 H3s under each H2. Write in a conversational tone.'}
              rows={8}
              className={`w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent resize-y ${
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
                These override the default length and structure rules, up to a ceiling of{' '}
                {MAX_ARTICLE_WORDS.toLocaleString()} words. The post title is rendered as the
                page <code>H1</code> by WordPress, so the body always starts at <code>H2</code>.
              </p>
            )}
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              disabled={saving}
              className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || Boolean(limitError)}
              className="flex-1 flex items-center justify-center gap-2 bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
            >
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</> : 'Save'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => !deleting && setDeleteTarget(null)}
        title="Delete instruction set"
      >
        <form onSubmit={handleDelete} className="space-y-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Delete{' '}
            <span className="font-semibold text-gray-900 dark:text-white">
              &ldquo;{deleteTarget?.name}&rdquo;
            </span>
            ? This cannot be undone.
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              If you want to delete this, please type in this 4 digit code
            </label>
            <div className="flex items-center gap-3">
              <span
                aria-label={`Confirmation code ${deleteCode.split('').join(' ')}`}
                className="select-none font-mono font-semibold tracking-[0.3em] text-lg text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-2.5"
              >
                {deleteCode}
              </span>
              <input
                type="text"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                placeholder="––––"
                aria-label="Type the confirmation code"
                className="flex-1 min-w-0 px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-lg font-mono tracking-[0.3em] text-gray-900 dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            </div>
            {codeInput.length === 4 && !codeMatches && (
              <p className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400 mt-1.5">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                That code doesn&apos;t match. Type {deleteCode} to confirm.
              </p>
            )}
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={deleting || !codeMatches}
              className="flex-1 flex items-center justify-center gap-2 bg-red-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {deleting ? <><Loader2 className="w-4 h-4 animate-spin" />Deleting…</> : 'Delete'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  )
}
