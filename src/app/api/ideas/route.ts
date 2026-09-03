import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateArticleIdea, AVAILABLE_MODELS, type RejectedIdea } from '@/lib/openrouter'
import { recordUsage, sumUsage, type UsageInfo } from '@/lib/ai-cost'
import { isNoRowsError } from '@/lib/knowledge-base'
import { MAX_ARCHIVED_IN_PROMPT } from '@/lib/idea-archive'

export const maxDuration = 120

/** A ceiling on what the browser can push into the prompt. */
const MAX_REJECTED = 25

/** Room for a paragraph of steering, not an article brief. */
const MAX_TOPIC = 600

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { site_id, model, rejected, topic } = await req.json()
  if (!site_id) return NextResponse.json({ error: 'Pick a site first' }, { status: 400 })

  // What the user typed in the idea box, when they typed anything. Blank is the
  // ordinary case and means "find me something we have not covered".
  const askedFor = typeof topic === 'string' ? topic.trim().slice(0, MAX_TOPIC) : ''

  // What this article has already been offered and had turned down. Sent by the
  // browser because it is the only thing that knows: a rejected idea is never
  // written down anywhere, so there is nothing on the server to read it from.
  const rejectedIdeas: RejectedIdea[] = Array.isArray(rejected)
    ? rejected
        .filter((r): r is RejectedIdea => !!r && typeof r.title === 'string' && !!r.title.trim())
        .slice(-MAX_REJECTED)
        .map((r) => ({
          title: r.title.trim().slice(0, 300),
          keywords: Array.isArray(r.keywords)
            ? r.keywords.filter((k): k is string => typeof k === 'string').slice(0, 10)
            : undefined,
        }))
    : []

  const { data: settings } = await supabase
    .from('api_settings')
    .select('openrouter_api_key, default_model')
    .eq('user_id', user.id)
    .single()

  const apiKey = settings?.openrouter_api_key
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OpenRouter API key not set. Add it in Settings.' },
      { status: 422 }
    )
  }

  // select('*') rather than naming knowledge_base: on a database where
  // migration 015 has not run yet, naming the column fails the whole query and
  // idea generation dies with it. This way the column is simply absent and the
  // prompt goes out without a knowledge base.
  const { data: site, error: siteError } = await supabase
    .from('sites').select('*').eq('id', site_id).eq('user_id', user.id).single()

  if (siteError && !isNoRowsError(siteError)) {
    // Anything other than "no such row" is a real failure — reporting it as a
    // missing site sends you looking for the wrong problem entirely.
    return NextResponse.json({ error: siteError.message }, { status: 500 })
  }
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  // Published *and* scheduled: a topic already queued is just as written-about
  // as one already live, and suggesting it would be a duplicate either way.
  const { data: existing } = await supabase
    .from('articles')
    .select('title')
    .eq('site_id', site_id)
    .eq('user_id', user.id)
    .in('status', ['published', 'scheduled'])

  const titles = (existing || []).map((a) => a.title).filter(Boolean)

  const knowledgeBase = (site.knowledge_base || '').trim()

  // Nothing published and nothing written about the company: there is no brief
  // at all, and the model can only guess from the site's name. Say so instead
  // of spending a call to find out — a guessed topic is worse than no topic.
  //
  // Unless the user brought their own subject, which is a brief in itself. A
  // brand new site with a typed request has everything it needs.
  if (titles.length === 0 && !knowledgeBase && !askedFor) {
    return NextResponse.json(
      {
        error: `${site.name} has no published articles yet and no knowledge base, so there is nothing to base an idea on. Add a knowledge base — what the company is and what it should be writing about — and the first idea comes from that.`,
        needs_knowledge_base: true,
        site_id: site.id,
        site_name: site.name,
      },
      { status: 422 }
    )
  }

  // Ideas turned down in earlier sessions. The browser only knows what it has
  // shown since it loaded, so without reading the archive back a topic you
  // rejected last month is a topic the model is free to suggest again --
  // which is the repetition this list exists to stop. Best-effort: on a
  // database where migration 019 has not run there is simply no archive to
  // read, and that must not stop an idea being generated.
  let archivedIdeas: RejectedIdea[] = []
  try {
    const { data: archived } = await supabase
      .from('archived_ideas')
      .select('title, keywords')
      .eq('user_id', user.id)
      .eq('site_id', site_id)
      .order('created_at', { ascending: false })
      .limit(MAX_ARCHIVED_IN_PROMPT)

    const alreadyListed = new Set(rejectedIdeas.map((r) => r.title.toLowerCase()))
    archivedIdeas = (archived || [])
      .filter((a) => a.title && !alreadyListed.has(String(a.title).toLowerCase()))
      .map((a) => ({
        title: String(a.title).slice(0, 300),
        keywords: Array.isArray(a.keywords) ? a.keywords.slice(0, 10) : undefined,
      }))
  } catch {}

  const avoidIdeas = [...rejectedIdeas, ...archivedIdeas]

  const resolvedModel = model || settings?.default_model || AVAILABLE_MODELS[0].id

  try {
    const calls: UsageInfo[] = []
    const idea = await generateArticleIdea({
      apiKey,
      model: resolvedModel,
      existingTitles: titles,
      siteName: site.name,
      knowledgeBase,
      topic: askedFor,
      rejectedIdeas: avoidIdeas,
      onUsage: (u) => calls.push(u),
    })

    // Retries are billed too, so the recorded cost is every attempt combined.
    const usageId = calls.length
      ? await recordUsage({
          supabase, userId: user.id, step: 'idea',
          usage: sumUsage(calls, resolvedModel),
        })
      : null

    return NextResponse.json({
      idea,
      compared_against: titles.length,
      avoided: avoidIdeas.length,
      /** Whether this came from a typed request or the model's own choosing. */
      from_topic: !!askedFor,
      usage_id: usageId,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not generate an idea' },
      { status: 500 }
    )
  }
}
