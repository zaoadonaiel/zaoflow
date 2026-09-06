import { task, logger } from '@trigger.dev/sdk/v3'
import { generateArticle, generateSEOMeta, fillSeoBlanks } from '@/lib/openrouter'
import { recordUsage, sumUsage, type UsageInfo } from '@/lib/ai-cost'

interface Payload {
  articleId: string
  userId: string
  siteId: string
  title: string
  keywords: string[]
  instructions?: string
  model: string
  apiKey: string
  knowledgeBase: string
}

/**
 * The manual "Generate with AI" flow lives here so the browser is not the
 * thing holding the generation open. The row is written as 'generating'
 * before this task starts; the task rewrites the same row to 'draft' when
 * it finishes and every generated field is on disk. Close the tab, lose
 * Wi-Fi, or reboot the machine — the article will be waiting as a draft
 * next time you open it.
 */
export const generateArticleTask = task({
  id: 'generate-article',
  maxDuration: 300,
  run: async (payload: Payload) => {
    const { createServiceClient } = await import('@/lib/supabase/server')
    const supabase = createServiceClient()

    logger.log('Generating article', { articleId: payload.articleId, model: payload.model })

    try {
      const articleCalls: UsageInfo[] = []
      const seoCalls: UsageInfo[] = []

      const articleResult = await generateArticle({
        apiKey: payload.apiKey,
        model: payload.model,
        title: payload.title,
        keywords: payload.keywords,
        instructions: payload.instructions,
        knowledgeBase: payload.knowledgeBase,
        wordCount: 1600,
        onUsage: (u) => articleCalls.push(u),
      })

      // Same retry-then-backfill shape the synchronous endpoint had, so the
      // SEO fields land guideline-compliant without any manual patching.
      let seoMeta = null
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const candidate = await generateSEOMeta(
            payload.apiKey, payload.model,
            payload.title, articleResult.content, payload.keywords,
            (u) => seoCalls.push(u),
          )
          if (candidate.focusKeyphrase && candidate.keyphraseSynonyms && candidate.yoastTitle && candidate.slug) {
            seoMeta = candidate; break
          }
          seoMeta = candidate
        } catch {}
      }
      seoMeta = fillSeoBlanks(seoMeta, {
        title: payload.title,
        keywords: payload.keywords,
        contentText: articleResult.excerpt || '',
      })
      const lifted = articleResult.extractedMetaDescription
      if (lifted && lifted.length >= 50) seoMeta.yoastMetaDescription = lifted.slice(0, 160)

      // Costs are attached to the row we already have, so the receipt lands
      // populated the moment the row transitions to draft.
      if (articleCalls.length) {
        await recordUsage({
          supabase, userId: payload.userId, step: 'article',
          usage: sumUsage(articleCalls, payload.model),
          articleId: payload.articleId,
        })
      }
      if (seoCalls.length) {
        await recordUsage({
          supabase, userId: payload.userId, step: 'seo',
          usage: sumUsage(seoCalls, payload.model),
          articleId: payload.articleId,
        })
      }

      const { error: updateError } = await supabase.from('articles').update({
        content: articleResult.content,
        word_count: articleResult.wordCount,
        excerpt: articleResult.excerpt,
        meta_description: articleResult.metaDescription,
        focus_keyphrase: seoMeta.focusKeyphrase,
        keyphrase_synonyms: seoMeta.keyphraseSynonyms,
        yoast_title: seoMeta.yoastTitle,
        yoast_meta_description: seoMeta.yoastMetaDescription,
        slug: seoMeta.slug,
        ai_model: payload.model,
        status: 'draft',
        trigger_job_id: null,
        updated_at: new Date().toISOString(),
      }).eq('id', payload.articleId).eq('user_id', payload.userId)

      if (updateError) throw new Error(`DB update failed: ${updateError.message}`)

      logger.log('Article generated and saved as draft', { articleId: payload.articleId })
      return { articleId: payload.articleId, wordCount: articleResult.wordCount }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      logger.error('generate-article failed', { articleId: payload.articleId, error: msg })

      // Take the row out of 'generating' so it does not look in-flight
      // forever — this way the UI stops polling and the user can retry.
      await supabase.from('articles').update({
        status: 'draft',
        trigger_job_id: null,
        updated_at: new Date().toISOString(),
      }).eq('id', payload.articleId).eq('user_id', payload.userId)

      throw err
    }
  },
})
