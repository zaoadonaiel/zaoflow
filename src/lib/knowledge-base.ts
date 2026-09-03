/**
 * The site knowledge base — who the company is, and the premise everything the
 * AI writes for that site has to sit inside.
 *
 * It is prepended to every idea prompt and every article prompt, so it is
 * capped: a long one is paid for on every single generation and crowds the
 * article instructions out of the model's attention.
 */
export const MAX_KNOWLEDGE_BASE_CHARS = 10000

export function knowledgeBaseLimitError(text: string): string | null {
  const length = text.trim().length
  if (length <= MAX_KNOWLEDGE_BASE_CHARS) return null
  const over = length - MAX_KNOWLEDGE_BASE_CHARS
  return `This knowledge base is ${length.toLocaleString()} characters, but it is capped at ${MAX_KNOWLEDGE_BASE_CHARS.toLocaleString()} — it is sent to the model on every generation. Trim it by ${over.toLocaleString()} characters.`
}

/**
 * The block the models actually see. Returns '' when the site has no knowledge
 * base, so callers can concatenate it unconditionally.
 */
export function knowledgeBaseBlock(knowledgeBase?: string | null): string {
  const kb = knowledgeBase?.trim()
  if (!kb) return ''

  return `COMPANY KNOWLEDGE BASE — read this before anything else.
It describes the company this site belongs to and the premise everything written for it must sit inside. Treat it as background truth: never contradict it, never invent facts about the company that it does not state, and make sure what you produce belongs on this company's site rather than on any site in the same industry.

${kb}

`
}

/**
 * Postgres "undefined column". The knowledge base ships in migration 015, so
 * until that has run against the database every query naming the column fails
 * outright — which is why nothing reads it by name.
 */
export function isMissingColumnError(error: { code?: string } | null): boolean {
  return error?.code === '42703'
}

/** PostgREST's "no rows" from .single() — a genuinely absent row, not a broken query. */
export function isNoRowsError(error: { code?: string } | null): boolean {
  return error?.code === 'PGRST116'
}

export const MIGRATION_REQUIRED_MESSAGE =
  'The knowledge base column is missing from the database. Run migration 015_site_knowledge_base.sql against Supabase, then try again.'
