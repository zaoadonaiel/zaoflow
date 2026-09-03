/**
 * The archive of ideas that were generated and turned down.
 *
 * Read by three places that must agree on what "not there yet" means: the
 * generator that files an idea away, the idea prompt that steers around what
 * is already in there, and the Archive page that lists it. Only the last of
 * those is allowed to complain — the other two carry on without the archive
 * rather than taking idea generation down with it.
 */

/**
 * Postgres "undefined table", and PostgREST's own name for a table missing
 * from its schema cache. Either means migration 019 has not run: the archive
 * is absent, not broken.
 */
export function isMissingTableError(error: { code?: string } | null): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205'
}

export const ARCHIVE_MIGRATION_MESSAGE =
  'The idea archive is missing from the database. Run migration 019_idea_archive.sql against Supabase, then try again.'

/** How many archived titles are worth sending to the model. */
export const MAX_ARCHIVED_IN_PROMPT = 25
