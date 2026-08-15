import { schedules, logger } from '@trigger.dev/sdk/v3'
import { generateAndPublishTask } from './generate-and-publish'
import { calcNextRunMulti } from '@/lib/schedule-utils'

export const scheduleRunnerTask = schedules.task({
  id: 'schedule-runner',
  cron: '0 * * * *',
  maxDuration: 120,
  run: async (payload) => {
    logger.log('Schedule runner started', { timestamp: payload.timestamp })

    const { createServiceClient } = await import('@/lib/supabase/server')
    const supabase = createServiceClient()

    const now = new Date()
    const { data: dueSchedules, error } = await supabase
      .from('schedules')
      .select('*, sites(*), profiles!user_id(id)')
      .eq('is_active', true)
      .lte('next_run', now.toISOString())

    if (error) {
      logger.error('Failed to fetch schedules', { error: error.message })
      return
    }

    logger.log(`Found ${dueSchedules?.length || 0} due schedules`)

    if (dueSchedules && dueSchedules.length > 0) {
    const userIds = [...new Set(dueSchedules.map((s) => s.user_id))]
    const { data: apiSettings } = await supabase
      .from('api_settings')
      .select('user_id, openrouter_api_key, default_model')
      .in('user_id', userIds)

    const apiKeyMap = Object.fromEntries((apiSettings || []).map((s) => [s.user_id, s]))

    for (const schedule of dueSchedules) {
      const userSettings = apiKeyMap[schedule.user_id]
      if (!userSettings?.openrouter_api_key) {
        logger.warn(`No API key for user ${schedule.user_id} — skipping schedule ${schedule.id}`)
        continue
      }

      const site = (schedule as Record<string, unknown>).sites as {
        url: string; wp_username: string; wp_app_password: string; secret_token: string; status: string
      }

      if (!site || site.status !== 'connected') {
        logger.warn(`Site not connected for schedule ${schedule.id}`)
        continue
      }

      const times: string[] = schedule.times_of_day?.length
        ? schedule.times_of_day
        : [schedule.time_of_day || '09:00']

      try {
        await generateAndPublishTask.trigger({
          scheduleId: schedule.id,
          siteId: schedule.site_id,
          userId: schedule.user_id,
          topicPrompt: schedule.topic_prompt,
          aiModel: schedule.ai_model || userSettings.default_model,
          apiKey: userSettings.openrouter_api_key,
          siteUrl: site.url,
          wpUsername: site.wp_username,
          wpAppPassword: site.wp_app_password,
          secretToken: site.secret_token,
          wpCategoryId: schedule.wp_category_id || undefined,
          publishImmediately: true,
        })

        logger.log(`Triggered generation for schedule ${schedule.id}`)

        // Find the next time any slot should fire (after now)
        const nextRun = calcNextRunMulti(schedule.frequency, times, now)
        await supabase.from('schedules').update({
          next_run: nextRun.toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', schedule.id)
      } catch (err) {
        logger.error(`Failed to trigger schedule ${schedule.id}`, {
          error: err instanceof Error ? err.message : 'Unknown',
        })
      }
    }
    } // end if dueSchedules
  },
})
