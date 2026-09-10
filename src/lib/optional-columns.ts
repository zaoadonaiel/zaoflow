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
  optional: string | string[],
  // PromiseLike, not Promise: a Supabase query builder is awaitable but is not
  // itself a Promise, and callers pass one straight through.
  write: (payload: Record<string, unknown>) => PromiseLike<{ data: T | null; error: any }>
): Promise<{ data: T | null; error: any }> {
  // Track which columns we have already dropped so a retry does not keep
  // trying the same one when a payload has several optionals in flight.
  const optionals = Array.isArray(optional) ? optional : [optional]
  const remaining = new Set(optionals)
  let current: Record<string, unknown> = payload

  // Bounded by the number of optionals -- each iteration either succeeds or
  // drops exactly one column. An unrelated failure short-circuits.
  for (let i = 0; i <= optionals.length; i++) {
    const result = await write(current)

    if (!result.error || !isUnknownColumn(result.error)) return result

    const message = String(result.error.message || '')
    const culprit = [...remaining].find((col) => message.includes(col))
    if (!culprit) return result

    remaining.delete(culprit)
    const { [culprit]: _dropped, ...rest } = current
    current = rest
  }

  // All optionals dropped and still failing -- return the last attempt.
  return write(current)
}
