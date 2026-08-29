'use client'

import { useState } from 'react'
import { MessagesSquare, Loader2, Send } from 'lucide-react'
import { format } from 'date-fns'
import type { AuthorSide } from '@/lib/collab'

export interface ThreadMessage {
  id: string
  body: string
  author_side?: AuthorSide | string | null
  author_name?: string | null
  is_billable?: boolean
  resolved_at?: string | null
  created_at: string
}

interface Props {
  messages: ThreadMessage[]
  /** Which side the person reading this is on — theirs sit on the right. */
  mySide: AuthorSide
  /** False once the article is published: the record stays, the box goes. */
  canPost: boolean
  placeholder?: string
  /** Shown above the box, e.g. the revision billing note. */
  notice?: React.ReactNode
  onSend: (body: string) => Promise<void>
  closedNote?: string
  /**
   * An extra control beside a message's timestamp — the team's Done/Reopen.
   * Passed in rather than built in, because marking a note handled is a thing
   * only one side of the thread can do.
   */
  renderMeta?: (m: ThreadMessage) => React.ReactNode
}

/**
 * One conversation, both sides.
 *
 * Laid out as messages rather than a list of notes because that is what it is
 * now: the client says something and the team answers in the same place. Who
 * said it has to be readable at a glance, so a side and a name sit on every
 * message — the thread outlives the people in it.
 */
export default function CollabThread({
  messages, mySide, canPost, placeholder, notice, onSend, closedNote, renderMeta,
}: Props) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  async function submit() {
    if (!draft.trim() || sending) return
    setSending(true)
    try {
      await onSend(draft.trim())
      setDraft('')
    } catch {
      // Left in the box on purpose: a message that did not send must not
      // disappear as though it had.
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 mt-5">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <MessagesSquare className="w-4 h-4 text-gray-400" />
        Collab Here
      </h2>

      {messages.length > 0 && (
        <div className="space-y-3 mb-5">
          {messages.map((m) => {
            const mine = (m.author_side || 'client') === mySide
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] min-w-0 ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                  <span className="text-[11px] text-gray-400 px-1 mb-0.5">
                    {m.author_name || (mine ? 'You' : 'Them')}
                  </span>
                  <div
                    className={`rounded-2xl px-4 py-2.5 ${
                      mine
                        ? 'bg-brand-600 text-white rounded-br-sm'
                        : 'bg-gray-100 dark:bg-gray-900/60 text-gray-800 dark:text-gray-200 rounded-bl-sm'
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                  </div>
                  <span className="text-[11px] text-gray-400 px-1 mt-0.5 flex flex-wrap items-center gap-1.5">
                    {format(new Date(m.created_at), 'MMM d, h:mm a')}
                    {/* Only the team is shown what a note costs. The client is
                        told at the point of sending one, not billed at in the
                        transcript afterwards. */}
                    {mySide === 'team' && m.is_billable && (
                      <span className="text-amber-500">· billable $10</span>
                    )}
                    {m.resolved_at && (
                      <span className="text-green-600 dark:text-green-400">
                        · Revised {format(new Date(m.resolved_at), 'MM/dd/yyyy')}
                      </span>
                    )}
                    {renderMeta?.(m)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {canPost ? (
        <>
          {notice}
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter is a new line — the shape of every
                // message box, and this one reads as one.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
              rows={2}
              maxLength={4000}
              placeholder={placeholder || 'Write a message…'}
              className="flex-1 min-w-0 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm text-gray-900 dark:text-white resize-y"
            />
            <button
              onClick={submit}
              disabled={!draft.trim() || sending}
              aria-label="Send"
              className="h-11 px-4 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-40 inline-flex items-center gap-2 flex-shrink-0"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {closedNote || 'This article has already been published, so the thread is a record only.'}
        </p>
      )}
    </div>
  )
}
