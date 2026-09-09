import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getPostFull } from '@/lib/wordpress'
import {
  parseCity,
  replaceCityInText,
  replaceCityInHtml,
  replaceCityInSlug,
} from '@/lib/seo-city-swap'

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
  // name, so "Palos Verdes" → "palos-verdes-ca" when the source was "-ca".
  const tgt = parseCity(target_city, src.state)

  const newSlug = replaceCityInSlug(page.slug, src, tgt)
  const newTitle = replaceCityInText(page.title, src, tgt)
  // Content is HTML — tag internals are left alone so classes, image URLs and
  // Gutenberg block markers all survive the swap.
  const newContent = replaceCityInHtml(page.content, src, tgt)
  const newExcerpt = replaceCityInText(page.excerpt || '', src, tgt)

  // Yoast fields are plain text.
  const yoastTitle = page.yoastTitle ? replaceCityInText(page.yoastTitle, src, tgt) : ''
  const yoastMetaDescription = page.yoastMetaDescription
    ? replaceCityInText(page.yoastMetaDescription, src, tgt)
    : ''
  const focusKeyphrase = page.focusKeyphrase ? replaceCityInText(page.focusKeyphrase, src, tgt) : ''
  const keyphraseSynonyms = page.keyphraseSynonyms
    ? replaceCityInText(page.keyphraseSynonyms, src, tgt)
    : ''

  return NextResponse.json({
    source: {
      id: page.id,
      slug: page.slug,
      title: page.title,
      link: page.link,
      yoast_title: page.yoastTitle || '',
      yoast_meta_description: page.yoastMetaDescription || '',
      focus_keyphrase: page.focusKeyphrase || '',
      keyphrase_synonyms: page.keyphraseSynonyms || '',
    },
    clone: {
      slug: newSlug,
      title: newTitle,
      content: newContent,
      excerpt: newExcerpt,
      yoast_title: yoastTitle,
      yoast_meta_description: yoastMetaDescription,
      focus_keyphrase: focusKeyphrase,
      keyphrase_synonyms: keyphraseSynonyms,
      source_city: src.display,
      target_city: tgt.display,
    },
  })
}
