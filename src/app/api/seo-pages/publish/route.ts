import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { publishPage, uploadMedia, extensionForImageUrl } from '@/lib/wordpress'

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { seoPageId, scheduledAt } = await req.json()
  if (!seoPageId) return NextResponse.json({ error: 'seoPageId is required' }, { status: 400 })

  const { data: seoPage } = await supabase
    .from('seo_pages')
    .select('*, sites(*)')
    .eq('id', seoPageId)
    .eq('user_id', user.id)
    .single()

  if (!seoPage) return NextResponse.json({ error: 'SEO page not found' }, { status: 404 })

  const site = (seoPage as Record<string, unknown>).sites as {
    site_type?: 'wordpress' | 'nodejs' | 'other'
    url: string
    wp_username: string
    wp_app_password: string
  } | null

  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  if (site.site_type !== 'wordpress') {
    return NextResponse.json({ error: 'SEO Pages publish only to WordPress' }, { status: 400 })
  }

  await supabase.from('seo_pages').update({ status: 'publishing' }).eq('id', seoPageId)

  try {
    const pageStatus = scheduledAt ? 'future' : 'publish'

    let featuredMediaId: number | undefined
    let imageWarning: string | undefined
    if (seoPage.featured_image_url) {
      try {
        const imgUrl = seoPage.featured_image_url as string
        const ext = extensionForImageUrl(imgUrl)
        featuredMediaId = await uploadMedia({
          siteUrl: site.url,
          username: site.wp_username,
          appPassword: site.wp_app_password,
          imageUrl: imgUrl,
          filename: `${seoPage.slug || seoPage.id}${ext}`,
          altText: seoPage.featured_image_alt || undefined,
        })
      } catch (imgErr) {
        imageWarning = imgErr instanceof Error ? imgErr.message : 'Featured image upload failed'
      }
    }

    const wpResult = await publishPage({
      siteUrl: site.url,
      username: site.wp_username,
      appPassword: site.wp_app_password,
      page: {
        title: seoPage.title,
        content: seoPage.content,
        excerpt: seoPage.excerpt || '',
        status: pageStatus,
        dateGmt: scheduledAt || undefined,
        slug: seoPage.slug || undefined,
        featuredMediaId,
        focusKeyphrase: seoPage.focus_keyphrase || undefined,
        keyphraseSynonyms: seoPage.keyphrase_synonyms || undefined,
        yoastTitle: seoPage.yoast_title || undefined,
        yoastMetaDescription: seoPage.yoast_meta_description || undefined,
      },
      existingPageId: seoPage.wp_page_id || undefined,
    })

    await supabase.from('seo_pages').update({
      status: scheduledAt ? 'scheduled' : 'published',
      published_at: scheduledAt ? null : new Date().toISOString(),
      scheduled_at: scheduledAt || null,
      wp_page_id: wpResult.id,
      wp_page_url: wpResult.link,
      updated_at: new Date().toISOString(),
    }).eq('id', seoPageId)

    return NextResponse.json({
      success: true,
      id: wpResult.id,
      url: wpResult.link,
      imageWarning,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Publish failed'
    await supabase.from('seo_pages').update({
      status: 'failed',
      updated_at: new Date().toISOString(),
    }).eq('id', seoPageId)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
