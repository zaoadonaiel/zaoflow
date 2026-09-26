import { schedules, logger } from '@trigger.dev/sdk/v3'
import {
  generateArticle,
  generateArticleIdea,
  generateSEOMeta,
  fillSeoBlanks,
  type SEOMeta,
} from '@/lib/openrouter'
import { generateImage, getDefaultSize } from '@/lib/image-gen'
import { runWithFallback } from '@/lib/generation-retry'
import {
  getRandomSlotInWindow,
  todayInZone,
  addDays,
} from '@/lib/autopilot-schedule'
import { zonedWallClockToUtc, zoneById, getZonedParts, type CivilDate } from '@/lib/timezone'
import { resolveLengthTarget } from '@/lib/article-length'
import { recordUsage, sumUsage, fetchGenerationCost, type UsageInfo } from '@/lib/ai-cost'

/**
 * Autopilot's hourly heartbeat.
 *
 * For every site that has Autopilot on-and-not-paused, this fills a rolling
 * 72-hour queue up to three articles. The design goal is that an autopilot
 * article is indistinguishable from a manually made one — same schema, same
 * publish-due path, same edit URL — so nothing downstream needs to know
 * autopilot exists. `source = 'autopilot'` is the one discriminator, and it
 * only exists so this task can count its own past work when deciding
 * whether to generate more.
 *
 * Cron cadence is once an hour. That's tight enough to backfill within an
 * hour of a publish, and loose enough that a site quietly toggled on doesn't
 * fire off three OpenRouter chains within seconds of the click.
 *
 * Failure handling: any step that runs out of primary+fallback models leaves
 * the article as a draft with whatever was successfully generated so far,
 * and writes a publish_logs row so the user has an audit trail. The tick
 * itself never throws — one bad site must not block the others.
 */

const QUEUE_TARGET = 3
const WINDOW_HOURS = 72
const WINDOW_MS = WINDOW_HOURS * 60 * 60 * 1000
/** How many days ahead we're willing to look when the next 3 are all blocked. */
const MAX_DAY_LOOKAHEAD = 7
/** Cap the batch per tick — one hour, one site, one image chain each. */
const MAX_ARTICLES_PER_TICK_PER_SITE = 3

interface AutopilotSiteRow {
  id: string
  user_id: string
  name: string
  url: string
  status: string
  default_tz: string
  wp_category_id?: number | null
  knowledge_base?: string | null
  autopilot_enabled: boolean
  autopilot_paused: boolean
  autopilot_model_combo_id: string | null
}

interface ModelComboRow {
  id: string
  idea_model: string | null
  article_model: string | null
  seo_model: string | null
  image_model: string | null
}

export const autopilotTickTask = schedules.task({
  id: 'autopilot-tick',
  cron: '0 * * * *',
  // The tick is CPU-bounded on API waits, not on Node work — most of the
  // budget goes to OpenRouter round trips. Each article is roughly one idea
  // call + one long article call + one SEO call + one image call + a WP
  // publish worth of media upload. 10 min buffers three articles × several
  // sites without brushing Trigger.dev's 60 min ceiling.
  maxDuration: 600,
  run: async (payload) => {
    logger.log('Autopilot tick starting', { timestamp: payload.timestamp })

    const { createServiceClient } = await import('@/lib/supabase/server')
    const supabase = createServiceClient()

    const { data: sites, error: sitesErr } = await supabase
      .from('sites')
      .select('id, user_id, name, url, status, default_tz, wp_category_id, knowledge_base, autopilot_enabled, autopilot_paused, autopilot_model_combo_id')
      .eq('autopilot_enabled', true)
      .eq('autopilot_paused', false)

    if (sitesErr) {
      logger.error('Failed to load autopilot sites', { error: sitesErr.message })
      return
    }

    const active = (sites || []) as AutopilotSiteRow[]
    logger.log(`Autopilot: ${active.length} active site(s)`)

    // Pre-load API keys keyed by user_id so we round-trip once per unique user
    // rather than per site.
    const userIds = [...new Set(active.map((s) => s.user_id))]
    const apiSettingsMap = new Map<string, { openrouter_api_key: string; default_model: string }>()
    if (userIds.length) {
      const { data: apiRows } = await supabase
        .from('api_settings')
        .select('user_id, openrouter_api_key, default_model')
        .in('user_id', userIds)
      for (const r of apiRows || []) {
        if (r.openrouter_api_key) {
          apiSettingsMap.set(r.user_id, {
            openrouter_api_key: r.openrouter_api_key,
            default_model: r.default_model,
          })
        }
      }
    }

    for (const site of active) {
      try {
        await runForSite({ supabase, site, apiSettingsMap })
      } catch (err) {
        // Catch-all so one site's tick can't stop the loop. Anything worth
        // surfacing to the user was already written as a publish_logs row
        // inside runForSite.
        logger.error('Autopilot: site tick failed', {
          siteId: site.id,
          error: err instanceof Error ? err.message : 'Unknown',
        })
      }
    }
  },
})

async function runForSite({
  supabase, site, apiSettingsMap,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  site: AutopilotSiteRow
  apiSettingsMap: Map<string, { openrouter_api_key: string; default_model: string }>
}) {
  if (site.status !== 'connected') {
    logger.warn('Autopilot: skipping disconnected site', { siteId: site.id, status: site.status })
    return
  }

  const api = apiSettingsMap.get(site.user_id)
  if (!api?.openrouter_api_key) {
    logger.warn('Autopilot: no OpenRouter key for user', { userId: site.user_id, siteId: site.id })
    return
  }

  if (!site.autopilot_model_combo_id) {
    // API layer prevents this state normally, but a mid-tick combo delete
    // could leave the FK null. Skip rather than guess a model.
    logger.warn('Autopilot: site has no model combo set', { siteId: site.id })
    return
  }

  const { data: comboRow } = await supabase
    .from('model_combos')
    .select('id, idea_model, article_model, seo_model, image_model')
    .eq('id', site.autopilot_model_combo_id)
    .eq('user_id', site.user_id)
    .single()

  const combo = comboRow as ModelComboRow | null
  if (!combo?.idea_model || !combo.article_model || !combo.seo_model || !combo.image_model) {
    logger.warn('Autopilot: combo is missing a model slot', { siteId: site.id, comboId: site.autopilot_model_combo_id })
    return
  }

  const now = new Date()
  const windowEnd = new Date(now.getTime() + WINDOW_MS)

  // Existing autopilot articles in the queue window — these count against
  // the target, and their slots are the "already taken" days we must avoid.
  const { data: existing } = await supabase
    .from('articles')
    .select('id, scheduled_at, status')
    .eq('site_id', site.id)
    .eq('user_id', site.user_id)
    .eq('source', 'autopilot')
    .in('status', ['scheduled', 'draft'])
    .gte('scheduled_at', now.toISOString())
    .lte('scheduled_at', windowEnd.toISOString())

  const existingCount = existing?.length || 0
  const missing = Math.min(QUEUE_TARGET - existingCount, MAX_ARTICLES_PER_TICK_PER_SITE)
  if (missing <= 0) {
    logger.log('Autopilot: queue full', { siteId: site.id, existingCount })
    return
  }

  logger.log('Autopilot: generating articles', { siteId: site.id, missing, existingCount })

  const tz = site.default_tz || 'PST'
  const occupied = new Set<string>()
  for (const a of existing || []) {
    if (!a.scheduled_at) continue
    occupied.add(civilKeyFromIso(a.scheduled_at, tz))
  }

  // Pick the next N open days. Skips today when its window has already
  // passed in the site's zone, and skips any day already holding an
  // autopilot article — one article per morning window is the whole
  // point of a "3 articles in 3 days" queue.
  const targetDays: CivilDate[] = []
  let cursor = todayInZone(tz, now)
  if (windowEndOfDay(cursor, tz).getTime() <= now.getTime()) {
    cursor = addDays(cursor, 1)
  }
  let stepped = 0
  while (targetDays.length < missing && stepped < MAX_DAY_LOOKAHEAD) {
    const key = civilKey(cursor)
    if (!occupied.has(key)) {
      targetDays.push(cursor)
      occupied.add(key)
    }
    cursor = addDays(cursor, 1)
    stepped++
  }

  if (targetDays.length === 0) {
    logger.warn('Autopilot: no open days in lookahead window', { siteId: site.id })
    return
  }

  // Existing titles for the idea prompt so the model doesn't propose
  // something the site has already covered. Includes scheduled ones so
  // an idea queued this tick isn't proposed again next tick.
  const { data: titleRows } = await supabase
    .from('articles')
    .select('title')
    .eq('site_id', site.id)
    .eq('user_id', site.user_id)
    .in('status', ['published', 'scheduled'])
  const existingTitles = (titleRows || []).map((r: { title: string }) => r.title).filter(Boolean)

  // Best-effort instructions/length pull — the manual pipeline treats a
  // missing set as fine, and so does this.
  const { data: instructionRow } = await supabase
    .from('article_instructions')
    .select('instructions, min_words, target_words, max_words')
    .eq('user_id', site.user_id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  const instructionText = instructionRow?.instructions || undefined
  const length = resolveLengthTarget(instructionRow)

  const knowledgeBase = (site.knowledge_base || '').trim()

  for (const day of targetDays) {
    const slot = getRandomSlotInWindow(tz, day)
    try {
      await generateOne({
        supabase,
        site,
        apiKey: api.openrouter_api_key,
        combo,
        slot,
        tz,
        knowledgeBase,
        existingTitles,
        instructionText,
        length,
      })
      // Rolling: an idea we just produced counts against duplicates for
      // the next iteration too. We don't have the title until inside
      // generateOne, so we let the DB-backed uniqueness check pick it up
      // on the next tick — good enough at N=3 per site per hour.
    } catch (err) {
      logger.error('Autopilot: generation failed after fallbacks', {
        siteId: site.id,
        error: err instanceof Error ? err.message : 'Unknown',
      })
    }
  }
}

interface GenerateOneArgs {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  site: AutopilotSiteRow
  apiKey: string
  combo: ModelComboRow
  slot: Date
  tz: string
  knowledgeBase: string
  existingTitles: string[]
  instructionText?: string
  length: ReturnType<typeof resolveLengthTarget>
}

/**
 * One end-to-end autopilot article: idea → article → SEO → image → row.
 *
 * Each step runs through `runWithFallback` so a single flaky model does
 * not fail the whole article. If any step exhausts its retries+fallbacks,
 * the article is still written to the DB as a `draft` (with whatever
 * fields we did manage to produce), a publish_logs failure row is
 * inserted, and the caller moves on. A held draft is a signal the user
 * can act on — silently skipping a slot is not.
 */
async function generateOne({
  supabase, site, apiKey, combo, slot, tz,
  knowledgeBase, existingTitles, instructionText, length,
}: GenerateOneArgs) {
  const userId = site.user_id
  const siteId = site.id

  // Per-step usage buckets so we can bill autopilot's tokens back to the
  // user through the same ai_usage rows the manual flow uses.
  const ideaCalls: UsageInfo[] = []
  const articleCalls: UsageInfo[] = []
  const seoCalls: UsageInfo[] = []

  // Track what we've got so a partial failure still writes a useful draft.
  let title = ''
  let keywords: string[] = []
  let content = ''
  let excerpt = ''
  let metaDescription = ''
  let wordCount = 0
  let seo: SEOMeta | null = null
  let featuredImageUrl: string | null = null
  let featuredImagePrompt: string | null = null
  let modelUsedForArticle = combo.article_model || ''
  const failures: string[] = []

  // -- 1. IDEA --------------------------------------------------------------
  try {
    const { result: idea } = await runWithFallback({
      supabase, userId, step: 'idea',
      primaryModel: combo.idea_model!,
      onAttemptFail: (m, n, err) => logger.warn('idea attempt failed', {
        model: m, tryNumber: n, error: err instanceof Error ? err.message : String(err),
      }),
      attempt: (model) => generateArticleIdea({
        apiKey, model,
        existingTitles,
        siteName: site.name,
        knowledgeBase,
        topic: '',
        rejectedIdeas: [],
        onUsage: (u) => ideaCalls.push(u),
      }),
    })
    title = idea.title
    keywords = idea.keywords || []
  } catch (err) {
    failures.push(`idea: ${errText(err)}`)
    // Without a title there is nothing worth writing later — hand the
    // rest of the pipeline a placeholder so we still produce a draft
    // row the user can see and act on.
    title = 'Autopilot draft — idea generation failed'
  }

  // -- 2. ARTICLE BODY ------------------------------------------------------
  if (!failures.length) {
    try {
      const { result: article, model: usedModel } = await runWithFallback({
        supabase, userId, step: 'article',
        primaryModel: combo.article_model!,
        onAttemptFail: (m, n, err) => logger.warn('article attempt failed', {
          model: m, tryNumber: n, error: err instanceof Error ? err.message : String(err),
        }),
        attempt: (model) => generateArticle({
          apiKey, model,
          title, keywords,
          instructions: instructionText,
          knowledgeBase,
          length,
          onUsage: (u) => articleCalls.push(u),
        }),
      })
      content = article.content
      excerpt = article.excerpt
      metaDescription = article.metaDescription
      wordCount = article.wordCount
      modelUsedForArticle = usedModel
    } catch (err) {
      failures.push(`article: ${errText(err)}`)
    }
  }

  // -- 3. SEO ---------------------------------------------------------------
  // SEO can still run against a placeholder body — fillSeoBlanks will just
  // do more of the work — so we try even if the article step failed.
  try {
    const { result: seoResult } = await runWithFallback({
      supabase, userId, step: 'seo',
      primaryModel: combo.seo_model!,
      onAttemptFail: (m, n, err) => logger.warn('seo attempt failed', {
        model: m, tryNumber: n, error: err instanceof Error ? err.message : String(err),
      }),
      attempt: async (model) => {
        // Same 3-try acceptance loop the manual /api/generate uses, so a
        // model that returns an incomplete JSON on attempt 1 gets another
        // shot before we fall back to a different model.
        let best: SEOMeta | null = null
        for (let i = 0; i < 3; i++) {
          try {
            const candidate = await generateSEOMeta(
              apiKey, model, title, content, keywords,
              (u) => seoCalls.push(u),
            )
            if (candidate.focusKeyphrase && candidate.keyphraseSynonyms && candidate.yoastTitle && candidate.slug) {
              return candidate
            }
            best = candidate
          } catch {}
        }
        if (best) return best
        throw new Error('SEO fields incomplete after 3 attempts')
      },
    })
    seo = seoResult
  } catch (err) {
    failures.push(`seo: ${errText(err)}`)
  }
  // Whatever we have, land every Yoast field with a value derived from the
  // article so nothing publishes blank.
  const plainForSeo = (content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  seo = fillSeoBlanks(seo, { title, keywords, contentText: plainForSeo || title })

  // -- 4. FEATURED IMAGE ----------------------------------------------------
  const imagePrompt = `Professional blog featured image for: ${title}`
  featuredImagePrompt = imagePrompt
  try {
    const { result: img } = await runWithFallback({
      supabase, userId, step: 'image',
      primaryModel: combo.image_model!,
      onAttemptFail: (m, n, err) => logger.warn('image attempt failed', {
        model: m, tryNumber: n, error: err instanceof Error ? err.message : String(err),
      }),
      attempt: async (model) => {
        const genResult = await generateImage({
          apiKey, prompt: imagePrompt, model, size: getDefaultSize(model),
        })
        return { ...genResult, model }
      },
    })

    // Same storage flow as /api/generate-image, but service-role so no
    // session is needed inside the trigger.
    const { url: imageSource, b64, usage: imageUsage, generationId, model: imgModel } = img
    if (imageUsage.cost === undefined && generationId) {
      const reported = await fetchGenerationCost(generationId, apiKey)
      if (reported !== null) imageUsage.cost = reported
    }
    let imageBytes: Buffer
    let contentType = 'image/png'
    if (b64) {
      imageBytes = Buffer.from(b64, 'base64')
    } else if (imageSource) {
      const imgRes = await fetch(imageSource, { signal: AbortSignal.timeout(30000) })
      if (!imgRes.ok) throw new Error('Failed to download generated image')
      contentType = imgRes.headers.get('content-type') || 'image/png'
      imageBytes = Buffer.from(await imgRes.arrayBuffer())
    } else {
      throw new Error('Image generation returned no data')
    }
    const ext = contentType.includes('jpeg') ? 'jpg' : 'png'
    const storagePath = `${userId}/${Date.now()}-autopilot.${ext}`
    await supabase.storage.createBucket('article-images', { public: true }).catch(() => {})
    const { error: uploadError } = await supabase.storage
      .from('article-images')
      .upload(storagePath, imageBytes, { contentType, upsert: false })
    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`)
    const { data: { publicUrl } } = supabase.storage
      .from('article-images')
      .getPublicUrl(storagePath)
    featuredImageUrl = publicUrl

    // Best-effort image usage record — attaches to the article row after
    // we insert it below.
    await recordUsage({
      supabase, userId, step: 'image', usage: { ...imageUsage, model: imgModel },
    })
  } catch (err) {
    failures.push(`image: ${errText(err)}`)
  }

  // -- 5. INSERT ARTICLE ROW ------------------------------------------------
  const readyToSchedule = failures.length === 0 && !!content
  const insertRow = {
    user_id: userId,
    site_id: siteId,
    title,
    content: content || '',
    excerpt: excerpt || '',
    meta_description: metaDescription || (seo?.yoastMetaDescription ?? null),
    keywords,
    focus_keyword: seo?.focusKeyphrase || null,
    focus_keyphrase: seo?.focusKeyphrase || null,
    keyphrase_synonyms: seo?.keyphraseSynonyms || null,
    yoast_title: seo?.yoastTitle || null,
    yoast_meta_description: seo?.yoastMetaDescription || null,
    slug: seo?.slug || null,
    word_count: wordCount || null,
    ai_model: modelUsedForArticle,
    wp_category_id: site.wp_category_id || null,
    featured_image_url: featuredImageUrl,
    featured_image_prompt: featuredImagePrompt,
    // Only "scheduled" articles ride the publish-due cron. A partial
    // failure lands as a "draft" so the user has to look at it before it
    // goes live — silent publishing of a broken article is worse than
    // a visible held one.
    status: readyToSchedule ? 'scheduled' : 'draft',
    scheduled_at: readyToSchedule ? slot.toISOString() : null,
    scheduled_tz: readyToSchedule ? tz : null,
    is_paused: false,
    source: 'autopilot',
    trigger_job_id: 'autopilot',
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('articles')
    .insert(insertRow)
    .select('id')
    .single()

  if (insertErr) {
    logger.error('Autopilot: failed to insert article', {
      siteId, error: insertErr.message,
    })
    return
  }

  logger.log('Autopilot: article created', {
    articleId: inserted.id,
    status: insertRow.status,
    scheduledFor: insertRow.scheduled_at,
    failures: failures.length,
  })

  // Bill idea/article/seo now that we have an articleId to attach to.
  if (ideaCalls.length) {
    await recordUsage({
      supabase, userId, step: 'idea',
      usage: sumUsage(ideaCalls, combo.idea_model!),
      articleId: inserted.id,
    })
  }
  if (articleCalls.length) {
    await recordUsage({
      supabase, userId, step: 'article',
      usage: sumUsage(articleCalls, modelUsedForArticle),
      articleId: inserted.id,
    })
  }
  if (seoCalls.length) {
    await recordUsage({
      supabase, userId, step: 'seo',
      usage: sumUsage(seoCalls, combo.seo_model!),
      articleId: inserted.id,
    })
  }

  // Failure trail — one publish_logs row per held draft, so the "Publish
  // history" view and any alerting the user has already wired to
  // publish_logs surfaces the problem the same way it surfaces a normal
  // publish failure.
  if (failures.length) {
    await supabase.from('publish_logs').insert({
      article_id: inserted.id,
      site_id: siteId,
      user_id: userId,
      status: 'failed',
      error_message: `Autopilot held as draft — ${failures.join(' | ')}`.slice(0, 2000),
    })
  }
}

/** Read a civil date's day-in-zone as a compact key for the "occupied" set. */
function civilKey(c: CivilDate): string {
  return `${c.year}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`
}

function civilKeyFromIso(iso: string, tz: string): string {
  const p = getZonedParts(new Date(iso), zoneById(tz))
  return civilKey({ year: p.year, month: p.month, day: p.day })
}

/** 11:00 wall-clock on `civil` in `tz`, as a UTC Date — the window's cutoff. */
function windowEndOfDay(civil: CivilDate, tz: string): Date {
  return zonedWallClockToUtc(civil, 11, 0, zoneById(tz))
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
