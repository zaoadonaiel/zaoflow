/**
 * Per-site guidance for the image generator: free-text do/don't rules plus a
 * description of any reference images (owner headshot, logo, storefront). Both
 * ride at the top of every image prompt for the site so the model can't miss
 * them.
 *
 * Capped for the same reason the article knowledge base is capped: it is paid
 * for on every generation, and a runaway block crowds the actual prompt out of
 * the model's attention window.
 */
export const MAX_IMAGE_KB_CHARS = 4000

export function imageKnowledgeLimitError(text: string): string | null {
  const length = text.trim().length
  if (length <= MAX_IMAGE_KB_CHARS) return null
  const over = length - MAX_IMAGE_KB_CHARS
  return `This image guidance is ${length.toLocaleString()} characters, but it is capped at ${MAX_IMAGE_KB_CHARS.toLocaleString()} — it rides on every image. Trim it by ${over.toLocaleString()} characters.`
}

export interface ReferenceImageForPrompt {
  kind: 'person' | 'logo' | 'other'
  label?: string | null
  description?: string | null
}

/**
 * The block the models actually see. Returns '' when the site has neither
 * guidance nor reference images, so callers can concatenate unconditionally.
 *
 * The reference-image lines are written as instructions, not descriptions —
 * "the owner is a white woman, mid-40s" is what actually steers the generator,
 * because OpenRouter's `/images/generations` does not take image inputs
 * across models. The uploaded file is stored so the user can see what they're
 * referencing; the description is the load-bearing part for now.
 */
export function imageKnowledgeBlock(
  imageKnowledge: string | null | undefined,
  references: ReferenceImageForPrompt[] = [],
): string {
  const kb = (imageKnowledge || '').trim()
  const withDescriptions = references.filter((r) => (r.description || '').trim())

  if (!kb && withDescriptions.length === 0) return ''

  const lines: string[] = [
    'IMAGE GUIDANCE (top priority — obey before the main prompt).',
    'These rules describe the real business and the real people the image is for. Match them. Do not contradict them.',
  ]

  if (kb) lines.push('', kb)

  if (withDescriptions.length > 0) {
    lines.push('', 'REFERENCE SUBJECTS — if any of these appear in the scene, they must look like this and only this:')
    for (const ref of withDescriptions) {
      const label = ref.label?.trim() || ({
        person: 'Person',
        logo: 'Logo',
        other: 'Reference',
      } as const)[ref.kind]
      const kindLabel = ({
        person: 'PERSON',
        logo: 'LOGO / BRAND MARK',
        other: 'REFERENCE',
      } as const)[ref.kind]
      lines.push(`- ${kindLabel} — ${label}: ${(ref.description || '').trim()}`)
    }
    lines.push(
      'Never substitute a different ethnicity, gender, age or brand mark for one of the reference subjects above.',
    )
  }

  lines.push('') // trailing newline so downstream concatenation reads cleanly.
  return lines.join('\n')
}

export function isMissingImageKbColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === '42703') return true
  return typeof error.message === 'string' && /image_knowledge_base/.test(error.message)
}

export function isMissingReferenceTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  // 42P01 = undefined_table; PGRST205 = PostgREST "table not found in schema cache".
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  return typeof error.message === 'string' && /site_reference_images/.test(error.message)
}

export const IMAGE_KB_MIGRATION_MESSAGE =
  'Image guidance requires migration 043_site_image_knowledge.sql — run it against Supabase, then reopen this.'
