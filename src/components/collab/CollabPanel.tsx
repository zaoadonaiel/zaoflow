'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Check, Loader2, RotateCcw, Play, Pause } from 'lucide-react'
import toast from 'react-hot-toast'
import ActivityLog from '@/components/collab/ActivityLog'
import DraftList from '@/components/collab/DraftList'
import CollabThread, { type ThreadMessage } from '@/components/collab/CollabThread'
import { draftHtml } from '@/lib/diff-html'
import { draftLabel, EDIT_CLASS, type ArticleDraft, type CollabEvent, type AuthorSide } from '@/lib/collab'

interface Props {
  articleId: string
}

/**
 * The team's side of the collaboration: the same thread, log and versions the
 * client sees in their portal.
 *
 * Deliberately the same components as the portal renders. Two views of one
 * conversation that were built separately drift, and the first thing to drift
 * would be who said what — which is the one thing both sides have to agree on.
 */
export default function CollabPanel({ articleId }: Props) {
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [drafts, setDrafts] = useState<ArticleDraft[]>([])
  const [events, setEvents] = useState<CollabEvent[]>([])
  const [paused, setPaused] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [versionId, setVersionId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [commentsRes, collabRes] = await Promise.all([
        fetch(`/api/comments?article_id=${articleId}`),
        fetch(`/api/articles/${articleId}/collab`),
      ])

      const commentsData = await commentsRes.json()
      if (commentsRes.ok) setMessages(commentsData.comments || [])

      const collabData = await collabRes.json()
      if (collabRes.ok) {
        setDrafts(collabData.drafts || [])
        setEvents(collabData.events || [])
        setPaused(!!collabData.is_paused)
      } else if (collabRes.status === 503) {
        // A missing migration, said out loud. An empty history here would read
        // as "nothing has happened", which is the one thing a log must not say
        // when it simply cannot see.
        toast.error(collabData.error, { id: 'collab-migration', duration: 8000 })
      }
    } finally {
      setLoading(false)
    }
  }, [articleId])

  useEffect(() => { load() }, [load])

  async function toggleResolved(id: string, undo: boolean) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/comments/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ undo }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not update')
      toast.success(undo ? 'Reopened' : 'Marked done — the client sees Revision Complete')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update')
    } finally {
      setBusyId(null)
    }
  }

  async function send(body: string) {
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ article_id: articleId, body }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not send')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send')
      throw err
    }
  }

  if (loading) return null

  // Nothing has happened and nobody has said anything: an empty four-panel
  // collaboration board above every new article would be furniture.
  if (!messages.length && !drafts.length && !events.length) return null

  const open = messages.filter((m) => (m.author_side || 'client') === 'client' && !m.resolved_at)
  const reading = versionId ? drafts.find((d) => d.id === versionId) : null

  return (
    <div id="comments" className="grid lg:grid-cols-[17rem_minmax(0,1fr)] gap-5 items-start mb-5">
      <div className="space-y-5">
        <ActivityLog events={events} mySide="team" />
        <DraftList
          drafts={drafts}
          selectedId={versionId}
          onSelect={setVersionId}
          mySide="team"
        />
      </div>

      <div className="min-w-0">
        {/* The client's switch, as read-only status. It is theirs to set, but
            an article they left paused is one that will not publish, and that
            has to be legible from here. */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 px-5 py-4 flex flex-wrap items-center gap-3">
          {paused ? (
            <>
              <Pause className="w-5 h-5 text-gray-500" fill="currentColor" />
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Paused…</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                The client paused this. It will not publish until they approve it.
              </span>
            </>
          ) : (
            <>
              <Play className="w-5 h-5 approve-live" fill="currentColor" />
              <span className="text-sm font-semibold approve-live">Approved</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Publishes on its schedule.
              </span>
            </>
          )}

          {open.length > 0 && (
            <span className="ml-auto px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs font-medium">
              {open.length} {open.length === 1 ? 'note needs' : 'notes need'} attention
            </span>
          )}
        </div>

        {/* The version being read, changes marked. Only ever on screen: the
            stored article never carries the colours, so nothing has to
            remember to strip them before publishing. */}
        {reading && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 mt-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
              <h2 className={`text-sm font-semibold ${EDIT_CLASS[reading.author_side as AuthorSide]}`}>
                {draftLabel(reading)}
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Changes in this version are highlighted. Edit the article below to make
                the next one.
              </p>
            </div>
            <VersionBody drafts={drafts} selectedId={reading.id} />
          </div>
        )}

        <CollabThread
          messages={messages}
          mySide="team"
          canPost
          placeholder="Reply to the client…"
          onSend={send}
          renderMeta={(m) =>
            (m.author_side || 'client') === 'client' ? (
              <button
                onClick={() => toggleResolved(m.id, !!m.resolved_at)}
                disabled={busyId === m.id}
                className={
                  m.resolved_at
                    ? 'inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-40'
                    : 'inline-flex items-center gap-1 h-6 px-2 rounded-lg bg-green-600 text-white text-[11px] font-semibold hover:bg-green-700 disabled:opacity-40'
                }
              >
                {busyId === m.id ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : m.resolved_at ? (
                  <RotateCcw className="w-3 h-3" />
                ) : (
                  <Check className="w-3 h-3" />
                )}
                {m.resolved_at ? 'Reopen' : 'Done'}
              </button>
            ) : null
          }
        />
      </div>
    </div>
  )
}

/**
 * A stored version, changes marked.
 *
 * Its own component so the diff is memoised against the versions alone. The
 * panel sits above a live editor and re-renders as the article is typed; the
 * comparison it shows is between two things already written, and recomputing
 * it on every keystroke would be work for an answer that cannot change.
 */
function VersionBody({ drafts, selectedId }: { drafts: ArticleDraft[]; selectedId: string }) {
  const html = useMemo(() => draftHtml(drafts, selectedId)?.html || '', [drafts, selectedId])
  return (
    <article
      className="article-content text-gray-800 dark:text-gray-200 max-h-[32rem] overflow-y-auto"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
