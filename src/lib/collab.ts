/**
 * The shared vocabulary of a collaborated article: who wrote a version, what
 * happened to it, and what each of those is called on screen.
 *
 * Both sides read from here so the portal and the dashboard describe the same
 * event with the same words.
 */

export type AuthorSide = 'team' | 'client'

export type EventKind =
  | 'edited'
  | 'viewed'
  | 'reordered'
  | 'commented'
  | 'drafted'
  | 'paused'
  | 'resumed'

export interface ArticleDraft {
  id: string
  article_id: string
  author_side: AuthorSide
  author_name: string
  number: number
  title?: string | null
  content: string
  created_at: string
}

export interface CollabEvent {
  id: string
  kind: EventKind
  side?: AuthorSide | null
  actor?: string | null
  detail?: string | null
  created_at: string
}

/**
 * How the team signs its work to a client.
 *
 * The dashboard names the person who did the work, because internally that is
 * who you would go and ask. The portal does not: to the client the work comes
 * from the agency, and a staff name there is both noise and something they
 * never needed to be told.
 */
export const TEAM_BYLINE = 'The X Digital'

/** "The X Digital (Draft 2)" — how a version is named everywhere. */
export function draftLabel(d: { author_name: string; number: number }): string {
  return `${d.author_name} (Draft ${d.number})`
}

/** What a log line says happened. The actor's name is added around it. */
export const EVENT_VERB: Record<EventKind, string> = {
  edited: 'edited the article',
  viewed: 'opened the article',
  reordered: 'moved the article in the queue',
  commented: 'left a comment',
  drafted: 'saved a new draft',
  paused: 'paused publishing',
  resumed: 'approved for publishing',
}

/**
 * Colours for a side's changes.
 *
 * The client's edits follow the theme, because neither neon survives both
 * backgrounds: green on white is barely legible, purple on near-black loses
 * the glow. The team's stay blue in both — with only one side switching there
 * is never a moment where both read as the same colour.
 */
export const EDIT_CLASS: Record<AuthorSide, string> = {
  client: 'edit-client',
  team: 'edit-team',
}

/** The first words of a comment, for the log line. */
export function excerpt(text: string, max = 60): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean
}
