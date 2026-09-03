/**
 * Yoast/SEO field checks shown to clients on the portal.
 *
 * The limits match the counters already in the article editor, so the client's
 * view and the team's view can never disagree about whether a field is good.
 */

export interface SeoFieldValues {
  yoast_title?: string | null
  yoast_meta_description?: string | null
  slug?: string | null
  focus_keyphrase?: string | null
  keyphrase_synonyms?: string | null
}

export interface SeoCheck {
  label: string
  value: string
  length: number
  max: number
  pass: boolean
  /** Why it failed, for the row's secondary line. */
  note?: string
}

interface FieldSpec {
  key: keyof SeoFieldValues
  label: string
  max: number
  /** Optional fields are only listed when the article actually has one. */
  optional?: boolean
}

const FIELDS: FieldSpec[] = [
  { key: 'yoast_title', label: 'SEO Title', max: 70 },
  { key: 'yoast_meta_description', label: 'Meta Description', max: 160 },
  { key: 'slug', label: 'URL Slug', max: 60 },
  { key: 'focus_keyphrase', label: 'Focus Keyphrase', max: 60 },
  { key: 'keyphrase_synonyms', label: 'Keyphrase Synonyms', max: 100, optional: true },
]

/**
 * A field passes when it is filled in and within its character limit.
 *
 * Being under the limit is the whole criterion — a short field is not flagged.
 * A missing one is, since there is nothing there to meet the criterion.
 */
export function seoChecks(article: SeoFieldValues): SeoCheck[] {
  const out: SeoCheck[] = []

  for (const f of FIELDS) {
    const raw = (article[f.key] || '').trim()
    if (!raw && f.optional) continue

    const length = raw.length
    const pass = length > 0 && length <= f.max
    out.push({
      label: f.label,
      value: raw,
      length,
      max: f.max,
      pass,
      note: !raw ? 'Not set' : length > f.max ? `${length - f.max} over the limit` : undefined,
    })
  }

  return out
}
