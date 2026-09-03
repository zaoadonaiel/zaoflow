'use client'

/**
 * The models the pickers remember for you.
 *
 * Typing an OpenRouter model id into the custom box used to be a one-off: the
 * next generation went back to the built-in shortlist and the id had to be
 * looked up again. Anything picked is kept here instead, so it is on the list
 * the next time.
 *
 * Kept in localStorage alongside the favourites it sits next to, which means
 * per-browser rather than per-account. That is a real limit — a model kept on
 * a laptop is not on the phone — but it matches where favourites already live,
 * and a model id is cheap to re-add.
 */

export type ModelKind = 'text' | 'image'

const KEYS: Record<ModelKind, { kept: string; hidden: string }> = {
  text: { kept: 'zaoflo_kept_models_text', hidden: 'zaoflo_hidden_models_text' },
  image: { kept: 'zaoflo_kept_models_image', hidden: 'zaoflo_hidden_models_image' },
}

function read(key: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function write(key: string, list: string[]): string[] {
  try {
    localStorage.setItem(key, JSON.stringify(list))
  } catch {}
  return list
}

/** Models added by using them, oldest first. Never includes the built-ins. */
export function loadKept(kind: ModelKind): string[] {
  return read(KEYS[kind].kept)
}

/**
 * Keeps a model that was just chosen. Built-ins are already on the list, and
 * a model chosen twice is not two entries.
 */
export function keepModel(kind: ModelKind, id: string, builtInIds: string[]): string[] {
  const trimmed = id.trim()
  const kept = loadKept(kind)
  if (!trimmed || builtInIds.includes(trimmed) || kept.includes(trimmed)) return kept
  return write(KEYS[kind].kept, [...kept, trimmed])
}

/** Drops a kept model. Does nothing to a built-in — see hideBuiltIn. */
export function forgetModel(kind: ModelKind, id: string): string[] {
  return write(KEYS[kind].kept, loadKept(kind).filter((m) => m !== id))
}

/** Built-ins the user has deleted from their list. */
export function loadHidden(kind: ModelKind): string[] {
  return read(KEYS[kind].hidden)
}

/**
 * Deleting a built-in hides it rather than erasing it — the shortlist ships
 * with the app, so "delete" has to be undoable or it is a one-way door.
 */
export function hideBuiltIn(kind: ModelKind, id: string): string[] {
  const hidden = loadHidden(kind)
  return hidden.includes(id) ? hidden : write(KEYS[kind].hidden, [...hidden, id])
}

/** Puts every deleted built-in back on the list. */
export function restoreHidden(kind: ModelKind): string[] {
  return write(KEYS[kind].hidden, [])
}
