import { randomInt } from 'crypto'

/**
 * The URL segment for a client portal.
 *
 * Five groups of five digits — 10^25 possibilities, so it cannot be guessed or
 * enumerated. Numeric-with-hyphens because that is the shape the links are sent
 * out in; the entropy, not the format, is what protects it.
 */
export function generatePortalToken(): string {
  return Array.from({ length: 5 }, () =>
    String(randomInt(0, 100000)).padStart(5, '0')
  ).join('-')
}

/**
 * The private access code for a portal.
 *
 * Five digits, generated in the backend and shown only in the dashboard. It is
 * handed to the client separately from the link, so the link on its own no
 * longer opens anything. Padded rather than ranged from 10000, so 00042 is as
 * likely as any other code.
 */
export function generateAccessCode(): string {
  return String(randomInt(0, 100000)).padStart(5, '0')
}

/** What the client is allowed to type. Everything else is rejected unread. */
export const ACCESS_CODE_PATTERN = /^[0-9]{5}$/

/**
 * Wrong codes a client gets before the link stops answering.
 *
 * Three, and then it stays shut — not for fifteen minutes, but until the team
 * issues a new code from the dashboard. A timed lockout still leaves a script
 * grinding through 100,000 guesses a batch at a time; this ends the attempt and
 * puts a person back in the loop, which is the point.
 */
export const MAX_CODE_ATTEMPTS = 3

export type RevisionState = 'unseen' | 'approved' | 'in_progress' | 'revision_complete'

export interface CommentLike {
  resolved_at?: string | null
  created_at: string
}

/**
 * An article's review state, derived rather than stored, so the badge can never
 * drift from the comments and view it describes:
 *
 *   no comments, never opened -> unseen
 *   no comments, client opened it -> approved (silence after reading = fine)
 *   any comment unresolved -> in progress, until the team marks it done
 *   all comments resolved -> revision complete, stamped with the latest
 *
 * A comment outranks the view: an article the client commented on is never
 * "approved" just because they also opened it.
 */
export function revisionState(
  comments: CommentLike[],
  clientViewedAt?: string | null
): { state: RevisionState; revisedAt?: string } {
  if (comments.length) {
    const open = comments.some((c) => !c.resolved_at)
    if (open) return { state: 'in_progress' }

    const latest = comments
      .map((c) => c.resolved_at as string)
      .sort()
      .pop()
    return { state: 'revision_complete', revisedAt: latest }
  }

  return { state: clientViewedAt ? 'approved' : 'unseen' }
}

/** What each side calls a given state. The client sees softer wording. */
export const CLIENT_LABEL: Record<RevisionState, string> = {
  unseen: 'Unseen by client',
  approved: 'Approved',
  in_progress: 'In Progress',
  revision_complete: 'Revision Complete',
}

export const TEAM_LABEL: Record<RevisionState, string> = {
  unseen: 'Unseen by client',
  approved: 'Approved',
  in_progress: 'Needs Attention',
  revision_complete: 'Revision Complete',
}

/** Plain-text preview for a card, from the article's stored HTML. */
export function snippet(html: string, max = 180): string {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}
