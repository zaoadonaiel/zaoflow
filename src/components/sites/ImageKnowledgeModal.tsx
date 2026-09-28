'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2, AlertCircle, Camera, Trash2, Plus, User, Building2, Sparkles } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import {
  MAX_IMAGE_KB_CHARS,
  imageKnowledgeLimitError,
} from '@/lib/image-knowledge'
import toast from 'react-hot-toast'

interface ReferenceImage {
  id: string
  kind: 'person' | 'logo' | 'other'
  label: string
  description: string
  url: string
  bytes?: number | null
  created_at: string
}

interface Props {
  open: boolean
  onClose: () => void
  siteId: string
  siteName: string
  onSaved?: (imageKnowledgeBase: string) => void
}

const KIND_LABELS: Record<ReferenceImage['kind'], string> = {
  person: 'Person',
  logo: 'Logo / brand mark',
  other: 'Other reference',
}

/**
 * Per-site image guidance — the do/don't rules and the reference images the
 * generator should mimic. Opens without a code gate because it does not
 * rewrite an already-approved article; a stray edit just steers the next
 * generation, which is easy to undo.
 */
export default function ImageKnowledgeModal({
  open, onClose, siteId, siteName, onSaved,
}: Props) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [migrationRequired, setMigrationRequired] = useState(false)
  const [saving, setSaving] = useState(false)

  const [stored, setStored] = useState('')
  const [draft, setDraft] = useState('')
  const [references, setReferences] = useState<ReferenceImage[]>([])

  // The next-upload composer. Files land here first so the user can label
  // and describe them before they hit storage — a headshot with no
  // description does nothing to steer the generator.
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingKind, setPendingKind] = useState<ReferenceImage['kind']>('person')
  const [pendingLabel, setPendingLabel] = useState('')
  const [pendingDescription, setPendingDescription] = useState('')
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const limitError = imageKnowledgeLimitError(draft)
  const dirty = draft.trim() !== stored.trim()

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(`/api/sites/${siteId}/image-knowledge`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load image guidance')
      setStored(data.image_knowledge_base || '')
      setDraft(data.image_knowledge_base || '')
      setReferences(data.references || [])
      setMigrationRequired(Boolean(data.migration_required))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load image guidance')
    } finally {
      setLoading(false)
    }
  }, [siteId])

  useEffect(() => {
    if (!open) return
    setPendingFile(null)
    setPendingKind('person')
    setPendingLabel('')
    setPendingDescription('')
    load()
  }, [open, load])

  async function saveText() {
    if (limitError) { toast.error(limitError); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/sites/${siteId}/image-knowledge`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_knowledge_base: draft.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      setStored(data.image_knowledge_base || '')
      setDraft(data.image_knowledge_base || '')
      onSaved?.(data.image_knowledge_base || '')
      toast.success('Image guidance saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function pickFile(file: File | null) {
    if (!file) { setPendingFile(null); return }
    if (!/^image\//.test(file.type)) {
      toast.error('That is not an image')
      return
    }
    setPendingFile(file)
    // Prefill the label from the filename so people who just want to drop and
    // save something at least end up with a distinguishable row.
    if (!pendingLabel) setPendingLabel(file.name.replace(/\.[^.]+$/, '').slice(0, 60))
  }

  async function uploadReference() {
    if (!pendingFile) return
    if (!pendingDescription.trim()) {
      toast.error('Add a description — that is what actually steers the generator.')
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', pendingFile)
      form.append('kind', pendingKind)
      form.append('label', pendingLabel.trim())
      form.append('description', pendingDescription.trim())
      const res = await fetch(`/api/sites/${siteId}/reference-images`, {
        method: 'POST',
        body: form,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setReferences((prev) => [data.reference, ...prev])
      setPendingFile(null)
      setPendingLabel('')
      setPendingDescription('')
      if (fileRef.current) fileRef.current.value = ''
      toast.success('Reference added')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function deleteReference(id: string) {
    if (!confirm('Remove this reference image?')) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/sites/${siteId}/reference-images/${id}`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Delete failed')
      setReferences((prev) => prev.filter((r) => r.id !== id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeletingId(null)
    }
  }

  function handleClose() {
    if (saving || uploading) return
    if (dirty && !confirm('Close without saving your guidance changes?')) return
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`Image guidance — ${siteName}`}
      maxWidth="max-w-3xl"
    >
      <div className="space-y-5">
        <p className="flex items-start gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Sparkles className="w-4 h-4 mt-0.5 flex-shrink-0 text-gray-400" />
          <span>
            Rides on every image the generator makes for{' '}
            <span className="font-medium text-gray-700 dark:text-gray-300">{siteName}</span>.
            Use it for do/don&apos;t rules (&ldquo;no residential doors&rdquo;) and for
            describing real people or logos you upload below.
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
                  <code className="font-mono">043_site_image_knowledge.sql</code> yet. Run it
                  against Supabase and reopen this to save guidance.
                </span>
              </p>
            )}

            <section>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                Do&apos;s and don&apos;ts
              </label>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={7}
                placeholder={
                  'Do: photograph commercial rollup doors on warehouses, storefronts, industrial buildings.\n\n' +
                  "Don't: show residential homes or single-family garage doors — we only do commercial.\n\n" +
                  'Our owner is a white woman, mid-40s, shoulder-length blonde hair — when a person appears they should look like her.'
                }
                aria-label="Image guidance text"
                className={`w-full px-4 py-2.5 border rounded-xl text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent resize-y bg-gray-50 dark:bg-gray-700 ${
                  limitError
                    ? 'border-red-300 dark:border-red-800 focus:ring-red-500'
                    : 'border-gray-200 dark:border-gray-600 focus:ring-brand-500'
                }`}
              />
              <div className="flex items-center justify-between mt-1.5">
                {limitError ? (
                  <p className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                    {limitError}
                  </p>
                ) : (
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    {draft.trim().length.toLocaleString()} /{' '}
                    {MAX_IMAGE_KB_CHARS.toLocaleString()} characters
                  </p>
                )}
                <button
                  type="button"
                  onClick={saveText}
                  disabled={saving || !dirty || Boolean(limitError) || migrationRequired}
                  className="flex items-center gap-1.5 bg-brand-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
                >
                  {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving…</> : 'Save guidance'}
                </button>
              </div>
            </section>

            <section className="pt-4 border-t border-gray-100 dark:border-gray-700">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  Reference images ({references.length})
                </label>
              </div>

              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                Upload a photo of the owner, a staff headshot, or the brand logo. The description
                you write is what actually steers the generator — the file itself is kept for
                your reference.
              </p>

              {/* Uploader */}
              <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/30 p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingKind('person')}
                    className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                      pendingKind === 'person'
                        ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-400'
                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300'
                    }`}
                  >
                    <User className="w-3.5 h-3.5" />
                    Person
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingKind('logo')}
                    className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                      pendingKind === 'logo'
                        ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-400'
                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300'
                    }`}
                  >
                    <Building2 className="w-3.5 h-3.5" />
                    Logo
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingKind('other')}
                    className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                      pendingKind === 'other'
                        ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-700 text-brand-700 dark:text-brand-400'
                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300'
                    }`}
                  >
                    <Camera className="w-3.5 h-3.5" />
                    Other
                  </button>
                </div>

                <div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => pickFile(e.target.files?.[0] || null)}
                    className="block w-full text-xs text-gray-600 dark:text-gray-300 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-brand-50 file:text-brand-700 hover:file:bg-brand-100 dark:file:bg-brand-900/30 dark:file:text-brand-400"
                  />
                </div>

                <input
                  type="text"
                  value={pendingLabel}
                  onChange={(e) => setPendingLabel(e.target.value)}
                  placeholder={pendingKind === 'person' ? 'Label — e.g. "Owner Jane"' : pendingKind === 'logo' ? 'Label — e.g. "Primary logo"' : 'Label'}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />

                <textarea
                  value={pendingDescription}
                  onChange={(e) => setPendingDescription(e.target.value)}
                  rows={3}
                  placeholder={
                    pendingKind === 'person'
                      ? 'Describe the person the way the generator needs to draw them: ethnicity, age range, hair, build, styling. e.g. "White woman, mid-40s, shoulder-length blonde hair, warm smile, business-casual dress."'
                      : pendingKind === 'logo'
                      ? 'Describe the logo the generator should place: colours, wordmark, where it should appear. e.g. "Blue circular badge with white sans-serif wordmark ARIZONA ROLLUP DOOR, placed on shirts, vehicles or the top-right corner."'
                      : 'Describe what this reference is and how the generator should honour it.'
                  }
                  className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y"
                />

                <button
                  type="button"
                  onClick={uploadReference}
                  disabled={!pendingFile || uploading || migrationRequired}
                  className="w-full flex items-center justify-center gap-2 bg-brand-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors disabled:opacity-50"
                >
                  {uploading ? <><Loader2 className="w-4 h-4 animate-spin" />Uploading…</> : <><Plus className="w-4 h-4" />Add reference</>}
                </button>
              </div>

              {references.length > 0 && (
                <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {references.map((ref) => (
                    <li
                      key={ref.id}
                      className="flex gap-3 items-start p-3 rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800"
                    >
                      <div className="relative w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={ref.url} alt={ref.label || ref.kind} className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-gray-400">
                          {ref.kind === 'person'
                            ? <User className="w-3 h-3" />
                            : ref.kind === 'logo'
                            ? <Building2 className="w-3 h-3" />
                            : <Camera className="w-3 h-3" />}
                          {KIND_LABELS[ref.kind]}
                        </div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {ref.label || '—'}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-3">
                          {ref.description || <em className="text-amber-600 dark:text-amber-400">No description — will not steer the generator.</em>}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => deleteReference(ref.id)}
                        disabled={deletingId === ref.id}
                        title="Remove reference"
                        aria-label="Remove reference"
                        className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                      >
                        {deletingId === ref.id
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </Modal>
  )
}
