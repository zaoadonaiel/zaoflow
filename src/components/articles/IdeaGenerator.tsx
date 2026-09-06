'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Lightbulb, Loader2, RefreshCw, Check, BookMarked, Archive, X } from 'lucide-react'
import ModelSelect from '@/components/ui/ModelSelect'
import ConfirmSiteModal from '@/components/ui/ConfirmSiteModal'
import Modal from '@/components/ui/Modal'
import KnowledgeBaseModal from '@/components/sites/KnowledgeBaseModal'
import type { UsageRecord } from '@/lib/ai-cost'
import toast from 'react-hot-toast'

const IDEA_MODEL_KEY = 'zaoflo_last_model_ideas'

interface Idea {
  title: string
  description: string
  keywords: string[]
  /** Cost row for the call that produced this, attached when the article saves. */
  usageId?: string | null
  /** Full usage row so the receipt can itemise this line without a re-fetch. */
  receipt?: UsageRecord[] | null
}

interface Props {
  siteId: string
  /** Named in the prompt to add a knowledge base. */
  siteName?: string | null
  /** Applies the idea to the article being written. */
  onAccept: (idea: Idea) => void
  /** Opens the site picker, for when the confirmation says it is the wrong one. */
  onChangeSite?: () => void
}

/**
 * Suggests an article this site has not covered yet.
 *
 * Has its own model picker because idea generation is a cheap, short call —
 * there is no reason to spend the article model's rate on it.
 */
export default function IdeaGenerator({ siteId, siteName, onAccept, onChangeSite }: Props) {
  const [model, setModel] = useState('')
  // The site is named back before anything is generated for it — see
  // ConfirmSiteModal. Only the first ask: turning down an idea and asking for
  // another is already inside a confirmed run.
  const [confirming, setConfirming] = useState(false)
  const [idea, setIdea] = useState<Idea | null>(null)
  const [loading, setLoading] = useState(false)
  // Every idea shown for this article and regenerated away from, so the next
  // request is not character-for-character the one that produced the idea you
  // just turned down. The archive holds these too, but this list is what keeps
  // the steering exact within a session: it carries the idea's keywords, and
  // it is right even in the seconds before the archive write lands.
  const [rejected, setRejected] = useState<Idea[]>([])
  // The site has neither a back catalogue nor a knowledge base, so there is
  // nothing to write from — this asks for one rather than guessing.
  const [needsKnowledge, setNeedsKnowledge] = useState<string | null>(null)
  const [editingKnowledge, setEditingKnowledge] = useState(false)
  // What to write about, in your own words. Blank is the ordinary case and
  // leaves the model to find a subject the site has not covered.
  const [topic, setTopic] = useState('')
  const [newKeyword, setNewKeyword] = useState('')

  function addKeyword() {
    const k = newKeyword.trim()
    if (!k || !idea) return
    if (idea.keywords.includes(k)) { setNewKeyword(''); return }
    setIdea({ ...idea, keywords: [...idea.keywords, k] })
    setNewKeyword('')
  }

  // A different site has a different catalogue and brief, so nothing turned
  // down for the old one should be steering it.
  //
  // A *different* site, though — not the first one. On a new article the form
  // opens with no site and fills it in when /api/sites answers, which is a
  // second or two later on a cold start and can be a good deal longer. Reading
  // that as a change of site threw away whatever had been typed in the
  // meantime: you write your idea, look away to pick a model, and the box is
  // empty when you look back. The previous site is what says whether anything
  // actually changed.
  const previousSite = useRef(siteId)
  useEffect(() => {
    const previous = previousSite.current
    if (previous === siteId) return
    previousSite.current = siteId
    // Arriving at the first site is the form finishing loading, not a switch.
    if (!previous) return

    setRejected([])
    setIdea(null)
    // The steer belongs to the site it was typed for -- "our portfolio versus a
    // local designer" is not a brief for somebody else's company.
    setTopic('')
  }, [siteId])

  /**
   * Asks for an idea, telling the model what has already been turned down.
   *
   * `turningDown` is the idea on screen when Regenerate was pressed — pressing
   * it is the rejection, so it joins the list before the request goes out.
   */
  async function fetchIdea(turningDown?: Idea | null) {
    if (!siteId) { toast.error('Select a site first'); return }

    const avoid = turningDown ? [...rejected, turningDown] : rejected
    setRejected(avoid)
    setLoading(true)

    // Turning an idea down files it rather than throwing it away — a topic you
    // did not want today is often the one you want next month. Best-effort and
    // unawaited on purpose: whether the idea was kept must not decide whether
    // the next one gets generated.
    if (turningDown) {
      fetch('/api/ideas/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site_id: siteId,
          title: turningDown.title,
          description: turningDown.description,
          keywords: turningDown.keywords,
          // The call that produced it was paid for. Carrying the cost row
          // means restoring the idea later attaches that spend to the article
          // it becomes instead of leaving it orphaned.
          usage_id: turningDown.usageId ?? null,
        }),
      }).catch(() => {})
    }

    try {
      const res = await fetch('/api/ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site_id: siteId,
          model,
          // Sent on every request, regenerate included: turning an idea down
          // rejects the idea, not the subject that was asked for.
          topic: topic.trim(),
          rejected: avoid.map((r) => ({ title: r.title, keywords: r.keywords })),
        }),
      })
      const data = await res.json()
      if (data?.needs_knowledge_base) {
        // Not an error to bury in a toast — it names the one thing that would
        // let this work, so it gets a dialog with the way to fix it in it.
        setNeedsKnowledge(data.error)
        return
      }
      if (!res.ok) throw new Error(data.error || 'Could not generate an idea')
      setIdea({ ...data.idea, usageId: data.usage_id, receipt: data.receipt })
      setNewKeyword('')
      // Only worth saying when the model chose the subject: told what to write
      // about, an empty back catalogue is not news.
      if (data.compared_against === 0 && !avoid.length && !data.from_topic) {
        toast('No published articles yet — this is an opening topic.', { icon: '💡' })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not generate an idea')
    } finally {
      setLoading(false)
    }
  }

  return (
    // `scroll-mt-*` keeps the field visible when the mobile keyboard focuses
    // it — without this the browser scrolls the textarea to viewport top and
    // it lands behind the fixed mobile header (56px + a small buffer).
    <div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-900/10 p-3 scroll-mt-20 md:scroll-mt-0">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-2">
        <Lightbulb className="w-4 h-4 text-amber-500" />
        Generate Idea
      </h3>
      {/* Two ways to ask, one control. Type a subject and it writes to that;
          leave it empty and it goes looking for one the site has never
          published, which is what it always did. */}
      <label htmlFor="idea-topic" className="sr-only">What should this article be about?</label>
      {/* Twice the height on mobile so the placeholder is readable and a full
          brief fits without scrolling inside a two-row box. `resize-y` lets
          the corner-grabber drag it taller when a paragraph is being typed. */}
      <textarea
        id="idea-topic"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        rows={2}
        maxLength={600}
        placeholder="Optional — tell it what to write about. e.g. why companies are better off with a web designer with a strong portfolio than a local one"
        className="w-full px-3 py-2 mb-2 rounded-lg border border-amber-200 dark:border-amber-900/40 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-y min-h-[6rem] md:min-h-0 scroll-mt-20 md:scroll-mt-0"
      />
      <p className="text-[11px] text-amber-800/70 dark:text-amber-300/60 mb-2.5">
        {topic.trim()
          ? 'It will write to this, checking your titles so it does not repeat one.'
          : 'Leave blank and it picks a subject none of your titles have covered.'}
      </p>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        {/* Takes the rest of the row rather than a fixed 176px — the model name
            and its price were both truncating away in the narrower slot. */}
        <div className="flex-1 min-w-0 w-full">
          <ModelSelect
            value={model}
            onChange={setModel}
            variant="compact"
            lastModelKey={IDEA_MODEL_KEY}
          />
        </div>

        {!idea && (
          <button
            onClick={() => setConfirming(true)}
            disabled={loading || !siteId}
            className="w-full sm:w-auto flex items-center justify-center gap-2 bg-amber-500 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50 flex-shrink-0"
          >
            {loading
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Thinking…</>
              : <><Lightbulb className="w-3.5 h-3.5" />Generate idea</>}
          </button>
        )}
      </div>

      {idea && (
        <div className="mt-3 rounded-lg bg-white dark:bg-gray-800 border border-amber-100 dark:border-gray-700 p-4">
          {/* Editable in place. Underline appears on hover/focus so the read
              flows like a static card until the caret lands. */}
          <label htmlFor="idea-title" className="sr-only">Idea title</label>
          <input
            id="idea-title"
            value={idea.title}
            onChange={(e) => setIdea({ ...idea, title: e.target.value })}
            className="w-full font-semibold text-gray-900 dark:text-white bg-transparent border-b border-transparent hover:border-amber-200 dark:hover:border-amber-900/40 focus:border-amber-400 focus:outline-none py-0.5"
          />
          <label htmlFor="idea-description" className="sr-only">Idea description</label>
          <textarea
            id="idea-description"
            value={idea.description}
            onChange={(e) => setIdea({ ...idea, description: e.target.value })}
            rows={3}
            className="w-full text-sm text-gray-600 dark:text-gray-300 mt-1.5 bg-transparent border border-transparent hover:border-amber-200 dark:hover:border-amber-900/40 focus:border-amber-400 rounded-md focus:outline-none px-2 py-1 resize-y"
          />

          <div className="flex flex-wrap gap-1.5 mt-3 items-center">
            {idea.keywords.map((k, i) => (
              <span key={`${k}-${i}`} className="inline-flex items-center gap-0.5 pl-2 pr-1 py-0.5 rounded-md bg-gray-100 dark:bg-gray-700 text-xs text-gray-600 dark:text-gray-300">
                {k}
                <button
                  type="button"
                  onClick={() => setIdea({ ...idea, keywords: idea.keywords.filter((_, j) => j !== i) })}
                  className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                  aria-label={`Remove ${k}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <input
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); addKeyword() }
              }}
              onBlur={addKeyword}
              placeholder="Add keyword"
              className="px-2 py-0.5 rounded-md bg-transparent border border-dashed border-gray-300 dark:border-gray-600 text-xs text-gray-600 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:border-amber-400 min-w-[7rem]"
            />
          </div>

          {rejected.length > 0 && (
            <p className="text-xs text-gray-400 mt-3">
              Steering away from {rejected.length} idea{rejected.length === 1 ? '' : 's'} you
              turned down — kept in{' '}
              {/* Where they went, said plainly. Nothing is deleted here, and
                  the sentence that used to offer to clear the list would now
                  be a lie: the archive keeps steering either way. */}
              <Link
                href="/archive?tab=ideas"
                className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <Archive className="w-3 h-3" />
                Archive
              </Link>
              , to use later.
            </p>
          )}

          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={() => fetchIdea(idea)}
              disabled={loading}
              className="flex items-center gap-2 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              {loading
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Thinking…</>
                : <><RefreshCw className="w-3.5 h-3.5" />Regenerate</>}
            </button>
            <button
              onClick={() => { onAccept(idea); setIdea(null); setRejected([]); setNewKeyword('') }}
              disabled={loading}
              className="flex items-center gap-2 bg-green-600 text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" /> Yes
            </button>
          </div>
        </div>
      )}

      <Modal
        open={needsKnowledge !== null}
        onClose={() => setNeedsKnowledge(null)}
        title="Nothing to base an idea on yet"
      >
        <div className="space-y-4">
          <p className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
            <BookMarked className="w-4 h-4 mt-0.5 flex-shrink-0 text-gray-400" />
            <span>{needsKnowledge}</span>
          </p>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setNeedsKnowledge(null)}
              className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={() => { setNeedsKnowledge(null); setEditingKnowledge(true) }}
              className="flex-1 flex items-center justify-center gap-2 bg-brand-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-brand-700 transition-colors"
            >
              <BookMarked className="w-4 h-4" />
              Add knowledge base
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmSiteModal
        open={confirming}
        question="Are you sure you want to generate an idea for"
        siteName={siteName || null}
        onClose={() => setConfirming(false)}
        onChange={() => { setConfirming(false); onChangeSite?.() }}
        onConfirm={() => { setConfirming(false); fetchIdea() }}
      />

      {editingKnowledge && (
        <KnowledgeBaseModal
          open
          onClose={() => setEditingKnowledge(false)}
          siteId={siteId}
          siteName={siteName || 'this site'}
          onSaved={(knowledgeBase) => {
            setEditingKnowledge(false)
            // Straight into the retry the dialog was asking for, rather than
            // leaving the user to work out that the button now works.
            if (knowledgeBase.trim()) fetchIdea()
          }}
        />
      )}
    </div>
  )
}
