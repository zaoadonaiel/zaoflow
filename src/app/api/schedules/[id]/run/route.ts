import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateTopic, generateArticle } from '@/lib/openrouter'
import { publishPost } from '@/lib/wordpress'
import { calcNextRunMulti } from '@/lib/schedule-utils'
import { resolveLengthTarget } from '@/lib/article-length'

export const maxDuration = 300

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Load schedule + site
  const { data: schedule } = await supabase
    .from('schedules')
    .select('*, sites(*)')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!schedule) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })

  const site = schedule.sites as {
    id: string; url: string; wp_username: string; wp_app_password: string; status: string
  }

  if (!site || site.status !== 'connected') {
    return NextResponse.json({ error: 'WordPress site is not connected' }, { status: 422 })
  }

  // Load API key
  const { data: apiSettings } = await supabase
    .from('api_settings')
    .select('openrouter_api_key, default_model')
    .eq('user_id', user.id)
    .single()

  if (!apiSettings?.openrouter_api_key) {
    return NextResponse.json({ error: 'OpenRouter API key not set. Go to Settings.' }, { status: 422 })
  }

  const model = schedule.ai_model || apiSettings.default_model || 'anthropic/claude-sonnet-4.5'

  // The instruction set that scoped generation to the user's rules was
  // previously not loaded here, so length/tone/structure was silently ignored
  // on every scheduled run. Explicit link on the schedule wins; fall back to
  // the user's oldest set so accounts with one set at all still get honoured.
  let instructionRow: {
    instructions?: string | null
    min_words?: number | null
    target_words?: number | null
    max_words?: number | null
  } | null = null
  if (schedule.instruction_id) {
    const { data } = await supabase
      .from('article_instructions')
      .select('instructions, min_words, target_words, max_words')
      .eq('id', schedule.instruction_id)
      .eq('user_id', user.id)
      .single()
    instructionRow = data
  }
  if (!instructionRow) {
    const { data } = await supabase
      .from('article_instructions')
      .select('instructions, min_words, target_words, max_words')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    instructionRow = data
  }
  const instructionText = instructionRow?.instructions || undefined
  const length = resolveLengthTarget(instructionRow)

  try {
    // 1. Generate topic from the schedule's prompt
    const { title, keywords } = await generateTopic(
      apiSettings.openrouter_api_key,
      model,
      schedule.topic_prompt
    )

    // 2. Generate full article
    const { content, wordCount, excerpt, metaDescription } = await generateArticle({
      apiKey: apiSettings.openrouter_api_key,
      model,
      title,
      keywords,
      instructions: instructionText,
      length,
    })

    // 3. Save article to DB
    const { data: article, error: articleError } = await supabase
      .from('articles')
      .insert({
        user_id: user.id,
        site_id: schedule.site_id,
        schedule_id: schedule.id,
        title,
        content,
        keywords,
        excerpt,
        meta_description: metaDescription,
        word_count: wordCount,
        ai_model: model,
        wp_category_id: schedule.wp_category_id || null,
        status: 'publishing',
        trigger_job_id: 'manual-run',
      })
      .select()
      .single()

    if (articleError) throw new Error(`DB error: ${articleError.message}`)

    // 4. Publish to WordPress
    const wpResult = await publishPost({
      siteUrl: site.url,
      username: site.wp_username,
      appPassword: site.wp_app_password,
      post: {
        title,
        content,
        excerpt,
        status: 'publish',
        categories: schedule.wp_category_id ? [schedule.wp_category_id] : undefined,
      },
    })

    // 5. Update article record
    await supabase.from('articles').update({
      status: 'published',
      published_at: new Date().toISOString(),
      wp_post_id: wpResult.id,
      wp_post_url: wpResult.link,
      updated_at: new Date().toISOString(),
    }).eq('id', article.id)

    // 6. Log the publish
    await supabase.from('publish_logs').insert({
      article_id: article.id,
      site_id: schedule.site_id,
      user_id: user.id,
      status: 'success',
      wp_post_id: wpResult.id,
      wp_post_url: wpResult.link,
    })

    // 7. Update schedule: increment counter, set last_run, recalculate next_run
    const times: string[] = schedule.times_of_day?.length
      ? schedule.times_of_day
      : [schedule.time_of_day || '09:00']
    const nextRun = calcNextRunMulti(schedule.frequency, times)

    await supabase.from('schedules').update({
      articles_generated: (schedule.articles_generated || 0) + 1,
      last_run: new Date().toISOString(),
      next_run: nextRun.toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', schedule.id)

    if (wpResult.categoryWarning) {
      console.warn(`[schedule-run] schedule ${schedule.id}: ${wpResult.categoryWarning}`)
    }

    return NextResponse.json({
      success: true,
      title,
      articleId: article.id,
      url: wpResult.link,
      categoryWarning: wpResult.categoryWarning,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Run failed'

    // Log failure
    await supabase.from('publish_logs').insert({
      site_id: schedule.site_id,
      user_id: user.id,
      status: 'failed',
      error_message: msg,
      article_id: '00000000-0000-0000-0000-000000000000',
    }).then(null, () => {})

    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
