export interface Profile {
  id: string
  email: string
  full_name?: string
  avatar_url?: string
  created_at: string
}

export interface Site {
  id: string
  user_id: string
  name: string
  url: string
  site_type: 'wordpress' | 'nodejs' | 'other'
  wp_username?: string
  wp_app_password?: string
  node_api_url?: string
  secret_token: string
  status: 'connected' | 'disconnected' | 'error'
  plugin_installed: boolean
  last_sync?: string
  ga4_property_id?: string
  ga4_measurement_id?: string
  gsc_site_url?: string
  created_at: string
  updated_at: string
}

export interface Article {
  id: string
  user_id: string
  site_id: string
  title: string
  content: string
  excerpt?: string
  meta_description?: string
  keywords: string[]
  focus_keyword?: string
  status: 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed'
  scheduled_at?: string
  published_at?: string
  wp_post_id?: number
  wp_post_url?: string
  node_post_id?: string
  node_post_url?: string
  ai_model?: string
  word_count?: number
  wp_category_id?: number
  schedule_id?: string
  trigger_job_id?: string
  // SEO fields
  focus_keyphrase?: string
  keyphrase_synonyms?: string
  yoast_title?: string
  yoast_meta_description?: string
  slug?: string
  // Image
  featured_image_url?: string
  featured_image_prompt?: string
  created_at: string
  updated_at: string
  sites?: Site
}

export interface Schedule {
  id: string
  user_id: string
  site_id: string
  name: string
  frequency: 'daily' | 'every_48h' | 'weekly' | 'twice_monthly' | 'monthly' | 'custom'
  custom_cron?: string
  time_of_day: string
  times_of_day?: string[]
  timezone: string
  is_active: boolean
  next_run?: string
  last_run?: string
  articles_generated: number
  ai_model: string
  topic_prompt: string
  wp_category_id?: number
  created_at: string
  updated_at: string
  sites?: Site
}

export interface ArticleInstruction {
  id: string
  user_id: string
  name: string
  instructions: string
  created_at: string
  updated_at: string
}

export interface PublishLog {
  id: string
  article_id: string
  site_id: string
  user_id: string
  status: 'success' | 'failed' | 'pending'
  error_message?: string
  wp_post_id?: number
  wp_post_url?: string
  node_post_id?: string
  node_post_url?: string
  created_at: string
  articles?: Article
  sites?: Site
}

export interface GA4Property {
  propertyId: string
  displayName: string
  accountName: string
}

export interface GoogleConnection {
  id: string
  user_id: string
  access_token: string
  refresh_token: string
  expires_at: string
  scope: string
  google_email?: string
  created_at: string
  updated_at: string
}

export interface ApiSettings {
  id: string
  user_id: string
  openrouter_api_key?: string
  openai_api_key?: string
  default_model: string
  created_at: string
  updated_at: string
}

export interface GenerateArticlePayload {
  articleId: string
  title: string
  keywords: string[]
  instructions?: string
  model: string
  apiKey: string
  siteId: string
}

export interface PublishArticlePayload {
  articleId: string
  siteId: string
  scheduledAt?: string
}
