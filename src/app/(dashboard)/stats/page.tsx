import { createClient } from '@/lib/supabase/server'
import StatsClient, { type UsageRow } from './StatsClient'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = {
  step: 'idea' | 'article' | 'seo' | 'image'
  model: string
  cost_usd: number | null
  article_id: string | null
  created_at: string
  articles: { site_id: string | null; sites: { name: string } | null } | null
}

export default async function StatsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // One pass over the user's billing rows. Cap at 10k: enough headroom for any
  // reasonable individual, and if we ever blow past it we should push
  // aggregation into SQL via an RPC.
  const { data: rowsRaw } = await supabase
    .from('ai_usage')
    .select('step, model, cost_usd, article_id, created_at, articles(site_id, sites(name))')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: true })
    .limit(10000)

  const raw = (rowsRaw ?? []) as unknown as Raw[]
  const rows: UsageRow[] = raw.map((r) => ({
    step: r.step,
    model: r.model,
    cost_usd: r.cost_usd,
    article_id: r.article_id,
    created_at: r.created_at,
    site_name: r.articles?.sites?.name ?? null,
  }))

  return <StatsClient rows={rows} />
}
