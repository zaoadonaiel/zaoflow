import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getPostFull } from '@/lib/wordpress'

interface City {
  /** Human form for headings/body: "Los Angeles". */
  display: string
  /** Slug form without state: "los-angeles". */
  displaySlug: string
  /** State-qualified slug: "los-angeles-ca", or same as displaySlug when no state. */
  slug: string
  /** Two-letter state code, lowercase, or null when the input didn't include one. */
  state: string | null
}

/** Parse "Los Angeles CA" into its parts.
 *  A trailing 2-letter token is treated as a state code, so the slug can keep
 *  its "-ca" qualifier while the body text reads "Los Angeles" rather than
 *  "Los Angeles CA" mid-sentence. When the target city has no state and
 *  `fallbackState` is passed, the state inherits from the source — so typing
 *  just "Oakland" produces the slug "oakland-ca" when the source is "-ca". */
function parseCity(raw: string, fallbackState: string | null = null): City {
  const trimmed = raw.trim()
  if (!trimmed) return { display: '', displaySlug: '', slug: '', state: null }

  const words = trimmed.split(/\s+/)
  const last = words[words.length - 1]
  const hasState = words.length > 1 && /^[A-Za-z]{2}$/.test(last)

  const cityWords = hasState ? words.slice(0, -1) : words
  const state = hasState ? last.toLowerCase() : fallbackState

  const display = cityWords
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')

  const displaySlug = display
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')

  const slug = state ? `${displaySlug}-${state}` : displaySlug

  return { display, displaySlug, slug, state }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Case-insensitive, whole-substring replacement. */
function replaceCityEverywhere(input: string, from: string, to: string): string {
  if (!from || !input) return input
  return input.replace(new RegExp(escapeRegex(from), 'gi'), to)
}

/** Longest first so "los-angeles" never eats "los-angeles-ca" mid-replace. */
function replaceInSlug(slug: string, src: City, tgt: City): string {
  let out = replaceCityEverywhere(slug, src.slug, tgt.slug)
  if (src.displaySlug !== src.slug) {
    out = replaceCityEverywhere(out, src.displaySlug, tgt.displaySlug)
  }
  return out
}

/** Titles, headings, paragraphs — any embedded URL fragments swap first so the
 *  bare-city replacement doesn't leave a half-rewritten slug behind. */
function replaceInText(text: string, src: City, tgt: City): string {
  let out = replaceCityEverywhere(text, src.slug, tgt.slug)
  if (src.displaySlug !== src.slug) {
    out = replaceCityEverywhere(out, src.displaySlug, tgt.displaySlug)
  }
  out = replaceCityEverywhere(out, src.display, tgt.display)
  return out
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { site_id, source_page_id, source_city, target_city, source_kind } = body as {
    site_id?: string
    source_page_id?: number
    source_city?: string
    target_city?: string
    source_kind?: 'post' | 'page'
  }

  if (!site_id || !source_page_id || !source_city || !target_city) {
    return NextResponse.json(
      { error: 'site_id, source_page_id, source_city and target_city are all required' },
      { status: 400 },
    )
  }

  const resource: 'posts' | 'pages' = source_kind === 'page' ? 'pages' : 'posts'

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
    page = await getPostFull({
      siteUrl: site.url,
      username: site.wp_username,
      appPassword: site.wp_app_password,
      postId: Number(source_page_id),
      resource,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load source post'
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  const src = parseCity(source_city)
  // Target inherits the source's state code when the user typed just the city
  // name, so "Oakland" → "oakland-ca" when the source was "-ca".
  const tgt = parseCity(target_city, src.state)

  const newSlug = replaceInSlug(page.slug, src, tgt)
  const newTitle = replaceInText(page.title, src, tgt)
  const newContent = replaceInText(page.content, src, tgt)
  const newExcerpt = replaceInText(page.excerpt || '', src, tgt)

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
