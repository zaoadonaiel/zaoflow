/* eslint-disable @typescript-eslint/no-explicit-any */
import { isMissingColumnError } from './knowledge-base'

/**
 * "This column is not there yet", in both dialects.
 *
 * A read reaches Postgres and comes back with 42703. A write does not get
 * that far: PostgREST checks the payload against its own schema cache first
 * and answers PGRST204 -- "Could not find the 'x' column of 'y' in the schema
 * cache". Checking only the first means a write sails straight past the
 * fallback, which is exactly what happened to featured_image_alt.
 */
function isUnknownColumn(error: any): boolean {
  return isMissingColumnError(error) || error?.code === 'PGRST204'
}

/**
 * A write that survives a migration that has not been run yet.
 *
 * A deploy can reach the browser before the SQL reaches Supabase, and a save
 * that names a column the database does not have fails outright -- taking the
 * whole article with it, not just the one field. This runs the write, and if
 * that is the only reason it failed, drops the field and writes everything
 * else rather than losing the lot.
 *
 * Only for fields that are genuinely optional. Anything the article cannot be
 * correct without should fail loudly and name the migration instead.
 */
export async function writeWithOptionalColumn<T>(
  payload: Record<string, unknown>,
  optional: string,
  // PromiseLike, not Promise: a Supabase query builder is awaitable but is not
  // itself a Promise, and callers pass one straight through.
  write: (payload: Record<string, unknown>) => PromiseLike<{ data: T | null; error: any }>
): Promise<{ data: T | null; error: any }> {
  const first = await write(payload)

  if (
    !first.error ||
    !isUnknownColumn(first.error) ||
    !String(first.error.message || '').includes(optional)
  ) {
    return first
  }

  const { [optional]: _dropped, ...rest } = payload
  return write(rest)
}
