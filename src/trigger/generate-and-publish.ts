import { task, logger } from '@trigger.dev/sdk/v3'
import { generateArticle } from '@/lib/openrouter'
import { publishPost } from '@/lib/wordpress'
import { publishPost as publishNodePost } from '@/lib/nodejs-site'
import { resolveLengthTarget } from '@/lib/article-length'

interface GenerateAndPublishPayload {
  scheduleId: string
  siteId: string
  userId: string
  topicPrompt: string
  aiModel: string
  apiKey: string
  siteType?: 'wordpress' | 'nodejs'
  siteUrl: string
  wpUsername: string
  wpAppPassword: string
  nodeApiUrl?: string
  secretToken: string
  wpCategoryId?: number
  publishImmediately?: boolean
  /** Optional link to the article_instructions row that scopes length/tone/structure. */
  instructionId?: string | null
}

// Generates a unique article topic from a general prompt using AI
async function generateTopic(apiKey: string, model: string, prompt: string): Promise<{ title: string; keywords: string[] }> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: `Based on this content strategy: "${prompt}"

Generate a specific, unique, SEO-friendly article title and 3-5 target keywords.
Return ONLY valid JSON in this format:
{
  "title": "The specific article title",
  "keywords": ["keyword1", "keyword2", "keyword3"]
}`,
        },
      ],
      max_tokens: 200,
      response_format: { type: 'json_object' },
    }),
  })

  const data = await res.json()
  const content = data.choices?.[0]?.message?.content || '{}'
  return JSON.parse(content)
}

export const generateAndPublishTask = task({
  id: 'generate-and-publish',
  maxDuration: 300,
  run: async (payload: GenerateAndPublishPayload) => {
    const {
      scheduleId, siteId, userId, topicPrompt, aiModel, apiKey,
      siteType = 'wordpress', siteUrl, wpUsername, wpAppPassword, nodeApiUrl, secretToken,
      wpCategoryId, publishImmediately = true, instructionId,
    } = payload

    logger.log('Starting generate-and-publish task', { scheduleId, siteId })

    // Dynamically import Supabase to avoid Edge Runtime issues
    const { createServiceClient } = await import('@/lib/supabase/server')
    const supabase = createServiceClient()

    // Instruction set that scopes length/tone/structure. Falls back to the
    // user's oldest set when the schedule has no explicit link — this used to
    // be dropped entirely, which is why scheduled runs ignored the ask.
    let instructionRow: {
      instructions?: string | null
      min_words?: number | null
      target_words?: number | null
      max_words?: number | null
    } | null = null
    if (instructionId) {
      const { data } = await supabase
        .from('article_instructions')
        .select('instructions, min_words, target_words, max_words')
        .eq('id', instructionId)
        .eq('user_id', userId)
        .single()
      instructionRow = data
    }
    if (!instructionRow) {
      const { data } = await supabase
        .from('article_instructions')
        .select('instructions, min_words, target_words, max_words')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      instructionRow = data
    }
    const instructionText = instructionRow?.instructions || undefined
    const length = resolveLengthTarget(instructionRow)

    try {
      // Step 1: Generate a specific topic from the general prompt
      logger.log('Generating article topic...')
      const { title, keywords } = await generateTopic(apiKey, aiModel, topicPrompt)
      logger.log('Topic generated', { title })

      // Step 2: Generate the full article
      logger.log('Generating article content...')
      const { content, wordCount, excerpt, metaDescription, lengthRetried, lengthOutOfRange } = await generateArticle({
        apiKey,
        model: aiModel,
        title,
        keywords,
        instructions: instructionText,
        length,
      })
      logger.log('Article generated', { wordCount, lengthRetried, lengthOutOfRange, target: length })

      // Step 3: Save as article in DB
      const { data: article, error: articleError } = await supabase.from('articles').insert({
        user_id: userId,
        site_id: siteId,
        title,
        content,
        keywords,
        excerpt,
        meta_description: metaDescription,
        word_count: wordCount,
        ai_model: aiModel,
        wp_category_id: wpCategoryId || null,
        status: publishImmediately ? 'publishing' : 'draft',
        trigger_job_id: 'scheduled',
      }).select().single()

      if (articleError) throw new Error(`DB error: ${articleError.message}`)
      logger.log('Article saved to DB', { articleId: article.id })

      if (!publishImmediately) {
        logger.log('Article saved as draft — skipping publish')
        return { success: true, articleId: article.id, status: 'draft' }
      }

      // Step 4: Publish to the site
      if (siteType === 'nodejs') {
        logger.log('Publishing to Node.js site...')
        const nodeResult = await publishNodePost({
          apiUrl: nodeApiUrl || '',
          apiKey: secretToken,
          post: {
            title,
            content,
            excerpt,
            metaDescription,
            status: 'publish',
            publishedAt: new Date().toISOString(),
          },
        })
        logger.log('Published to Node.js site', { nodePostId: nodeResult.id, url: nodeResult.url })

        // Step 5: Update DB record
        await supabase.from('articles').update({
          status: 'published',
          published_at: new Date().toISOString(),
          node_post_id: nodeResult.id,
          node_post_url: nodeResult.url,
          updated_at: new Date().toISOString(),
        }).eq('id', article.id)

        // Log success
        await supabase.from('publish_logs').insert({
          article_id: article.id,
          site_id: siteId,
          user_id: userId,
          status: 'success',
          node_post_id: nodeResult.id,
          node_post_url: nodeResult.url,
        })

        // Update schedule counters
        await supabase.from('schedules').update({
          articles_generated: supabase.rpc('increment', { x: 1 }),
          last_run: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', scheduleId)

        return {
          success: true,
          articleId: article.id,
          nodePostId: nodeResult.id,
          url: nodeResult.url,
          status: 'published',
        }
      }

      logger.log('Publishing to WordPress...')
      const wpResult = await publishPost({
        siteUrl,
        username: wpUsername,
        appPassword: wpAppPassword,
        post: {
          title,
          content,
          excerpt,
          status: 'publish',
          categories: wpCategoryId ? [wpCategoryId] : undefined,
        },
      })
      logger.log('Published to WordPress', { wpPostId: wpResult.id, url: wpResult.link })

      if (wpResult.categoryWarning) {
        logger.warn('Category not applied', {
          articleId: article.id,
          requestedCategory: wpCategoryId,
          warning: wpResult.categoryWarning,
        })
      }

      // Step 5: Update DB record
      await supabase.from('articles').update({
        status: 'published',
        published_at: new Date().toISOString(),
        wp_post_id: wpResult.id,
        wp_post_url: wpResult.link,
        updated_at: new Date().toISOString(),
      }).eq('id', article.id)

      // Log success
      await supabase.from('publish_logs').insert({
        article_id: article.id,
        site_id: siteId,
        user_id: userId,
        status: 'success',
        wp_post_id: wpResult.id,
        wp_post_url: wpResult.link,
      })

      // Update schedule counters
      await supabase.from('schedules').update({
        articles_generated: supabase.rpc('increment', { x: 1 }),
        last_run: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', scheduleId)

      return {
        success: true,
        articleId: article.id,
        wpPostId: wpResult.id,
        url: wpResult.link,
        status: 'published',
        categoryWarning: wpResult.categoryWarning,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      logger.error('Task failed', { error: msg })

      try {
        await supabase.from('publish_logs').insert({
          site_id: siteId,
          user_id: userId,
          status: 'failed',
          error_message: msg,
          article_id: '00000000-0000-0000-0000-000000000000',
        })
      } catch { /* best effort */ }

      throw err
    }
  },
})
