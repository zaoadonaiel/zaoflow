import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { deletePost } from '@/lib/wordpress'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: article, error } = await supabase
    .from('articles')
    .select('*, sites(*)')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (error || !article) return NextResponse.json({ error: 'Article not found' }, { status: 404 })
  return NextResponse.json({ article })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const allowedFields = ['title', 'content', 'keywords', 'excerpt', 'meta_description',
    'site_id', 'ai_model', 'status', 'scheduled_at', 'word_count', 'wp_post_id', 'wp_post_url',
    'wp_category_id']

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowedFields) {
    if (key in body) updates[key] = body[key]
  }

  const { data: article, error } = await supabase
    .from('articles')
    .update(updates)
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ article })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Load article + site so we can delete from WordPress too
  const { data: article } = await supabase
    .from('articles')
    .select('wp_post_id, sites(url, wp_username, wp_app_password)')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!article) return NextResponse.json({ error: 'Article not found' }, { status: 404 })

  // Delete from WordPress if it was published there
  let wpDeleted = false
  let wpError: string | null = null
  if (article.wp_post_id) {
    const site = (article as Record<string, unknown>).sites as {
      url: string; wp_username: string; wp_app_password: string
    } | null
    if (site) {
      try {
        await deletePost({
          siteUrl: site.url,
          username: site.wp_username,
          appPassword: site.wp_app_password,
          postId: article.wp_post_id,
        })
        wpDeleted = true
      } catch (err) {
        wpError = err instanceof Error ? err.message : 'WordPress delete failed'
      }
    }
  }

  // Delete from DB regardless of WP outcome
  const { error } = await supabase
    .from('articles')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, wpDeleted, wpError })
}
