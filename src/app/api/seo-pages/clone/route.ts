import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getPage } from '@/lib/wordpress'

/** "Los Angeles CA" → { slug: "los-angeles-ca", display: "Los Angeles" }.
 *  Strips a trailing 2-letter state code from the display form only, so the
 *  slug keeps its state qualifier while the body text does not read "San
 *  Diego CA" mid-sentence. */
function normaliseCity(raw: string): { slug: string; display: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { slug: '', display: '' }

  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')

  // Drop trailing state token for the body display: "san diego ca" → "san diego".
  const words = trimmed.split(/\s+/)
  const displayWords = words.length > 1 && /^[A-Za-z]{2}$/.test(words[words.length - 1])
    ? words.slice(0, -1)
    : words
  const display = displayWords
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')

  return { slug, display }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Case-insensitive, whole-substring replacement. Runs over the display string
 *  ("Los Angeles") and, separately, over the slug string ("los-angeles-ca") so
 *  the two live in different regexes and can't clobber each other. */
function replaceCityEverywhere(input: string, from: string, to: string): string {
  if (!from || !input) return input
  return input.replace(new RegExp(escapeRegex(from), 'gi'), to)
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { site_id, source_page_id, source_city, target_city } = body as {
    site_id?: string
    source_page_id?: number
    source_city?: string
    target_city?: string
  }

  if (!site_id || !source_page_id || !source_city || !target_city) {
    return NextResponse.json(
      { error: 'site_id, source_page_id, source_city and target_city are all required' },
      { status: 400 },
    )
  }

  const { data: site } = await supabase
    .from('sites')
    .select('id, site_type, url, wp_username, wp_app_password')
    .eq('id', site_id)
    .eq('user_id', user.id)
    .single()

  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  if (site.site_type !== 'wordpress') {
    return NextResponse.json({ error: 'Cloning is only supported for WordPress sites' }, { status: 400 })
  }

  let page
  try {
    page = await getPage({
      siteUrl: site.url,
      username: site.wp_username,
      appPassword: site.wp_app_password,
      pageId: Number(source_page_id),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load source page'
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  const src = normaliseCity(source_city)
  const tgt = normaliseCity(target_city)

  // Slug first, then display — the slug form usually contains the display form
  // as a substring ("los-angeles" ⊂ "los-angeles-ca") so replacing the longer
  // one first prevents a partial match from wrecking the state qualifier.
  const newSlug = replaceCityEverywhere(
    replaceCityEverywhere(page.slug, src.slug, tgt.slug),
    src.display.toLowerCase(),
    tgt.display.toLowerCase(),
  )

  const newTitle = replaceCityEverywhere(
    replaceCityEverywhere(page.title, src.slug, tgt.slug),
    src.display,
    tgt.display,
  )

  const newContent = replaceCityEverywhere(
    replaceCityEverywhere(page.content, src.slug, tgt.slug),
    src.display,
    tgt.display,
  )

  const newExcerpt = replaceCityEverywhere(
    replaceCityEverywhere(page.excerpt || '', src.slug, tgt.slug),
    src.display,
    tgt.display,
  )

  return NextResponse.json({
    source: {
      id: page.id,
      slug: page.slug,
      title: page.title,
      link: page.link,
    },
    clone: {
      slug: newSlug,
      title: newTitle,
      content: newContent,
      excerpt: newExcerpt,
      source_city: src.display,
      target_city: tgt.display,
    },
  })
}
