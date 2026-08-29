import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * The image library: every image this user has generated, newest first.
 *
 * Rows recovered from storage by migration 014 have no url of their own, so the
 * public URL is rebuilt from storage_path here rather than in the browser.
 */
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const siteId = searchParams.get('site_id')
  // "unassigned" is a filter, not an id: images generated before their article
  // was saved never got a site.
  const unassigned = siteId === 'unassigned'

  let query = supabase
    .from('generated_images')
    .select('id, article_id, site_id, prompt, model, url, storage_path, created_at, prompt_tokens, completion_tokens, total_tokens, cost_usd, bytes, sites(name), articles(title)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(500)

  if (unassigned) query = query.is('site_id', null)
  else if (siteId) query = query.eq('site_id', siteId)

  const { data, error } = await query

  if (error) {
    // A missing table or column reads as "you have no images" if it is
    // swallowed, which is indistinguishable from data loss. Say what actually
    // happened, and which migration closes the gap -- the two failures look
    // alike in the browser but need different SQL.
    const notFound = /does not exist|schema cache/i.test(error.message)
    const missingTable = notFound && /generated_images/.test(error.message)
    const missingColumn =
      notFound && /(prompt_tokens|completion_tokens|total_tokens|cost_usd|bytes)/.test(error.message)

    const hint = missingColumn
      ? 'The image library is missing its cost and size columns — run supabase/migrations/016_image_usage.sql.'
      : missingTable
      ? 'The image library table is missing — run supabase/migrations/014_generated_images.sql.'
      : null

    return NextResponse.json(
      { error: hint ?? error.message },
      { status: hint ? 503 : 500 }
    )
  }

  const images = (data || []).map((row) => {
    const url =
      row.url ||
      (row.storage_path
        ? supabase.storage.from('article-images').getPublicUrl(row.storage_path).data.publicUrl
        : null)
    return { ...row, url }
  }).filter((row) => !!row.url)

  return NextResponse.json({ images })
}
