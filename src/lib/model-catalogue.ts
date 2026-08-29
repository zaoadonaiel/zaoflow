'use client'

/**
 * The OpenRouter catalogue, as the model pickers see it.
 *
 * Shared between the text and image pickers because /api/models answers for
 * both in one response: several pickers on a page make one request between
 * them, and reopening either is instant.
 */

export interface ModelPricing {
  inputPerM: number
  outputPerM: number
  contextLength: number | null
  imagePerImage?: number | null
}

export interface Catalogue {
  pricing: Record<string, ModelPricing>
  /** Catalogue display names, keyed by id. Absent for ids it does not carry. */
  names: Record<string, string>
  /** Ids the catalogue carries. Only meaningful when `ok`. */
  available: Set<string>
  /**
   * Whether the catalogue was read at all. A model missing from a catalogue
   * that never loaded is unknown, not unavailable — the difference decides
   * whether the picker greys anything out.
   */
  ok: boolean
}

let pricingCache: Record<string, ModelPricing> = {}
let namesCache: Record<string, string> = {}
let availableCache = new Set<string>()
let okCache = false
let loadedOnce = false
/** Extra ids already asked about, so a kept model is priced once, not per open. */
const askedFor = new Set<string>()
const inFlight = new Map<string, Promise<Catalogue>>()

function snapshot(): Catalogue {
  return {
    pricing: { ...pricingCache },
    names: { ...namesCache },
    available: new Set(availableCache),
    ok: okCache,
  }
}

/**
 * Prices and availability for the built-in models plus any ids passed in.
 *
 * Ids already fetched are not re-requested; a call that adds nothing new and
 * finds the catalogue loaded resolves from cache without a request.
 */
export function loadCatalogue(extraIds: string[] = []): Promise<Catalogue> {
  const missing = extraIds.filter((id) => id && !askedFor.has(id))

  if (loadedOnce && !missing.length) return Promise.resolve(snapshot())

  const key = missing.length ? missing.slice().sort().join(',') : '__catalogue__'
  const existing = inFlight.get(key)
  if (existing) return existing

  const qs = missing.length ? `?ids=${encodeURIComponent(missing.join(','))}` : ''
  const request = fetch(`/api/models${qs}`)
    .then((r) => r.json())
    .then((d) => {
      pricingCache = { ...pricingCache, ...(d.pricing || {}) }
      namesCache = { ...namesCache, ...(d.names || {}) }
      for (const id of d.available || []) availableCache.add(id)
      // One failed refresh must not discard what an earlier one established.
      okCache = okCache || Boolean(d.ok)
      if (d.ok) {
        loadedOnce = true
        missing.forEach((id) => askedFor.add(id))
      }
      return snapshot()
    })
    .catch(() => snapshot())
    .finally(() => inFlight.delete(key))

  inFlight.set(key, request)
  return request
}

/** Forgets everything, so a newly kept model is priced on the next open. */
export function resetCatalogue() {
  pricingCache = {}
  namesCache = {}
  availableCache = new Set()
  okCache = false
  loadedOnce = false
  askedFor.clear()
}
