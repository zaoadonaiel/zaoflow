import { task, logger } from '@trigger.dev/sdk/v3'
import {
  parseCity,
  replaceCityInText,
  replaceCityInHtml,
  replaceCityInSlug,
} from '@/lib/seo-city-swap'
import {
  getPostFull,
  publishPost,
  findPostBySlug,
} from '@/lib/wordpress'
import { rewriteSeoContent, type Similarity } from '@/lib/seo-rewrite'

interface AutoPostRunPayload {
  runId: string
  userId: string
}

/**
 * Runs one Auto Post batch: for every target city in a run, clone the source
 * WordPress page, swap the city, optionally AI-rewrite, save a `seo_pages`
 * draft, and publish live. Per-city failures are captured in
 * `city_list_run_items` and don't halt the batch (the user opted for
 * "continue on failure" during scoping). The source page is fetched once
 * and reused across every city.
 */
export const autoPostRunTask = task({
  id: 'auto-post-run',
  // Sized for ~50 cities at ~30s each. Trigger.dev hard cap is 1h per task —
  // if a batch grows past that, it'll need to be split into child runs.
  maxDuration: 3600,
  run: async (payload: AutoPostRunPayload) => {
    const { runId, userId } = payload
    logger.log('Auto Post run starting', { runId, userId })

    const { createServiceClient } = await import('@/lib/supabase/server')
    const supabase = createServiceClient()

    const { data: run, error: runErr } = await supabase
      .from('city_list_runs')
      .select('*, sites(*)')
      .eq('id', runId)
      .eq('user_id', userId)
      .single()
    if (runErr || !run) {
      logger.error('Run row not found', { runId, error: runErr?.message })
      throw new Error(runErr?.message || 'Run not found')
    }

    const site = (run as Record<string, unknown>).sites as {
      site_type?: 'wordpress' | 'nodejs' | 'other'
      url: string
      wp_username: string
      wp_app_password: string
    } | null
    if (!site || site.site_type !== 'wordpress') {
      await failRun(supabase, runId, 'Site is not a WordPress site')
      return { ok: false as const, reason: 'site-not-wordpress' }
    }

    const { data: apiSettings } = await supabase
      .from('api_settings')
      .select('openrouter_api_key')
      .eq('user_id', userId)
      .single()
    const apiKey = apiSettings?.openrouter_api_key as string | undefined

    // Rewrite is optional; if the run is in city-only mode we don't need the
    // key. Only bail when the config demands rewrite + we don't have a key.
    const needsRewrite = !run.city_only_mode && run.rewrite_similarity && run.ai_model
    if (needsRewrite && !apiKey) {
      await failRun(supabase, runId, 'OpenRouter API key is missing for this user')
      return { ok: false as const, reason: 'missing-api-key' }
    }

    let instructionText: string | undefined
    if (run.instruction_id) {
      const { data } = await supabase
        .from('article_instructions')
        .select('instructions')
        .eq('id', run.instruction_id)
        .eq('user_id', userId)
        .maybeSingle()
      instructionText = data?.instructions || undefined
    }

    // One WP round-trip for the source page — reused for every target city.
    let source
    try {
      source = await getPostFull({
        siteUrl: site.url,
        username: site.wp_username,
        appPassword: site.wp_app_password,
        postId: Number(run.source_page_id),
        resource: run.source_kind === 'page' ? 'pages' : 'posts',
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load source page'
      await failRun(supabase, runId, msg)
      return { ok: false as const, reason: 'source-fetch-failed', error: msg }
    }

    await supabase
      .from('city_list_runs')
      .update({ status: 'running', updated_at: new Date().toISOString() })
      .eq('id', runId)

    const { data: items, error: itemsErr } = await supabase
      .from('city_list_run_items')
      .select('id, position, target_city')
      .eq('run_id', runId)
      .eq('user_id', userId)
      .order('position', { ascending: true })

    if (itemsErr || !items) {
      await failRun(supabase, runId, itemsErr?.message || 'Failed to load run items')
      return { ok: false as const, reason: 'items-fetch-failed' }
    }

    const src = parseCity(run.source_city)
    const resource: 'posts' | 'pages' = run.source_kind === 'page' ? 'pages' : 'posts'

    let succeeded = 0
    let failed = 0

    for (const item of items) {
      const startedAt = new Date().toISOString()
      await supabase
        .from('city_list_run_items')
        .update({ status: 'running', started_at: startedAt })
        .eq('id', item.id)

      try {
        const tgt = parseCity(item.target_city, src.state)

        const swappedTitle = replaceCityInText(source.title, src, tgt)
        const swappedSlug = replaceCityInSlug(source.slug, src, tgt)
        let swappedContent = replaceCityInHtml(source.content, src, tgt)
        const swappedExcerpt = replaceCityInText(source.excerpt || '', src, tgt)
        const swappedYoastTitle = source.yoastTitle ? replaceCityInText(source.yoastTitle, src, tgt) : ''
        const swappedYoastMeta = source.yoastMetaDescription
          ? replaceCityInText(source.yoastMetaDescription, src, tgt)
          : ''
        const swappedFocus = source.focusKeyphrase ? replaceCityInText(source.focusKeyphrase, src, tgt) : ''
        const swappedSyns = source.keyphraseSynonyms ? replaceCityInText(source.keyphraseSynonyms, src, tgt) : ''

        // Insert the seo_pages row *before* rewrite so any cost usage recorded
        // by rewriteSeoContent attaches to the right SEO page id.
        const { data: seoPage, error: insertErr } = await supabase
          .from('seo_pages')
          .insert({
            user_id: userId,
            site_id: run.site_id,
            source_page_id: source.id,
            source_slug: source.slug,
            source_title: source.title,
            source_city: src.display,
            target_city: tgt.display,
            title: swappedTitle,
            slug: swappedSlug,
            content: swappedContent,
            excerpt: swappedExcerpt,
            yoast_title: swappedYoastTitle || null,
            yoast_meta_description: swappedYoastMeta || null,
            focus_keyphrase: swappedFocus || null,
            keyphrase_synonyms: swappedSyns || null,
            ai_model: run.ai_model || null,
            instruction_id: run.instruction_id || null,
            rewrite_similarity: run.rewrite_similarity || null,
            source_template: source.template || null,
            set_location_meta: run.set_location_meta,
            status: 'publishing',
          })
          .select('id')
          .single()
        if (insertErr || !seoPage) throw new Error(insertErr?.message || 'Failed to save draft')

        if (needsRewrite && apiKey) {
          const result = await rewriteSeoContent({
            apiKey,
            content: swappedContent,
            model: run.ai_model as string,
            similarity: run.rewrite_similarity as Similarity,
            instructions: instructionText,
            targetCity: tgt.display,
            supabase,
            userId,
            seoPageId: seoPage.id,
          })
          swappedContent = result.content
          await supabase
            .from('seo_pages')
            .update({ content: swappedContent, updated_at: new Date().toISOString() })
            .eq('id', seoPage.id)
        }

        // Slug-collision handling. Default (from run config) is to override
        // any existing WP page with the same slug.
        let existingWpId: number | undefined
        if (run.override_existing) {
          const existing = await findPostBySlug({
            siteUrl: site.url,
            username: site.wp_username,
            appPassword: site.wp_app_password,
            slug: swappedSlug,
            resource,
          })
          if (existing) existingWpId = existing.id
        }

        const wpResult = await publishPost({
          siteUrl: site.url,
          username: site.wp_username,
          appPassword: site.wp_app_password,
          post: {
            title: swappedTitle,
            content: swappedContent,
            excerpt: swappedExcerpt,
            status: 'publish',
            slug: swappedSlug || undefined,
            focusKeyphrase: swappedFocus || undefined,
            keyphraseSynonyms: swappedSyns || undefined,
            yoastTitle: swappedYoastTitle || undefined,
            yoastMetaDescription: swappedYoastMeta || undefined,
            locationMeta: run.set_location_meta === false ? '' : '1',
            template: source.template ?? undefined,
          },
          existingPostId: existingWpId,
          resource,
        })

        const nowIso = new Date().toISOString()
        await supabase
          .from('seo_pages')
          .update({
            status: 'published',
            published_at: nowIso,
            wp_page_id: wpResult.id,
            wp_page_url: wpResult.link,
            updated_at: nowIso,
          })
          .eq('id', seoPage.id)

        await supabase
          .from('city_list_run_items')
          .update({
            status: 'published',
            seo_page_id: seoPage.id,
            wp_page_url: wpResult.link,
            completed_at: nowIso,
          })
          .eq('id', item.id)

        succeeded += 1
        await supabase
          .from('city_list_runs')
          .update({ succeeded, updated_at: nowIso })
          .eq('id', runId)

        logger.log('City published', { city: tgt.display, url: wpResult.link })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        failed += 1
        await supabase
          .from('city_list_run_items')
          .update({
            status: 'failed',
            error: msg,
            completed_at: new Date().toISOString(),
          })
          .eq('id', item.id)
        await supabase
          .from('city_list_runs')
          .update({ failed, updated_at: new Date().toISOString() })
          .eq('id', runId)
        logger.warn('City failed', { city: item.target_city, error: msg })
      }
    }

    await supabase
      .from('city_list_runs')
      .update({
        status: 'completed',
        succeeded,
        failed,
        updated_at: new Date().toISOString(),
      })
      .eq('id', runId)

    logger.log('Auto Post run finished', { runId, succeeded, failed })
    return { ok: true as const, succeeded, failed, total: items.length }
  },
})

async function failRun(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  runId: string,
  error: string,
) {
  await supabase
    .from('city_list_runs')
    .update({ status: 'failed', error, updated_at: new Date().toISOString() })
    .eq('id', runId)
}
