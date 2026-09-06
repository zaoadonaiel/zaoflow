import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Every billed generation attached to a batch of articles, grouped by article.
 *
 * A one-shot for the scheduler queue, which needs to itemise cost per row
 * without a fetch per article. POST rather than GET because the id list can
 * outgrow a query string on a busy site.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const ids: unknown = body?.article_ids
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ usage: {} })
  }
  const articleIds = ids.filter((v): v is string => typeof v === 'string')
  if (!articleIds.length) return NextResponse.json({ usage: {} })

  const { data: rows, error } = await supabase
    .from('ai_usage')
    .select('id, article_id, step, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, created_at')
    .in('article_id', articleIds)
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const usage: Record<string, unknown[]> = {}
  for (const row of rows || []) {
    const key = String(row.article_id)
    if (!usage[key]) usage[key] = []
    usage[key].push(row)
  }

  return NextResponse.json({ usage })
}
