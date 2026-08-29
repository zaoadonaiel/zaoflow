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
  /** Company background + premise, prepended to every idea and article prompt. */
  knowledge_base?: string
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
  /** Which of HST/PST/CT/EST the scheduled_at instant was picked in. */
  scheduled_tz?: string
  /** Scheduled but held back — keeps scheduled_at, stays as a draft on WordPress. */
  is_paused: boolean
  /** Set when the article is moved to Archive; null for everything in the working lists. */
  archived_at?: string | null
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
  /** What WordPress publishes as the image's alt text. Migration 020. */
  featured_image_alt?: string
  created_at: string
  updated_at: string
  sites?: Site
  /** Attached only when the list is asked for it; not columns. */
  events?: ArticleEvent[]
  usage?: AiUsage[]
}

export interface ArticleInstruction {
  id: string
  user_id: string
  name: string
  instructions: string
  created_at: string
  updated_at: string
}

/** An idea that was generated for a site and regenerated away from. */
export interface ArchivedIdea {
  id: string
  user_id: string
  site_id: string
  title: string
  description?: string | null
  keywords: string[]
  /** The cost row for the call that produced it, re-attached when it is used. */
  usage_id?: string | null
  created_at: string
  sites?: Site
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

export interface ClientPortal {
  id: string
  user_id: string
  site_id: string
  token: string
  /** The private 5-digit code. Generated here, given to the client by hand. */
  access_code: string
  client_name?: string
  is_active: boolean
  /** Wrong codes since the last good one. At MAX_CODE_ATTEMPTS the link is shut. */
  failed_attempts?: number
  last_viewed_at?: string | null
  created_at: string
  updated_at: string
  sites?: Site
  /** Attached by the dashboard list, not a column: times the code gate was passed. */
  open_count?: number
}

export interface ArticleComment {
  id: string
  article_id: string
  portal_id?: string | null
  user_id: string
  body: string
  is_billable: boolean
  resolved_at?: string | null
  created_at: string
  /** Which side of the collaboration wrote it. Older rows are all the client. */
  author_side?: 'team' | 'client'
  author_name?: string | null
  articles?: Article
}

/** One generated image, as the Image Library lists them. */
export interface GeneratedImage {
  id: string
  article_id?: string | null
  site_id?: string | null
  prompt?: string | null
  model?: string | null
  /** Always filled in by /api/images, rebuilt from storage_path when needed. */
  url: string
  storage_path?: string | null
  created_at: string
  /** All null on images generated before these were recorded — never zero. */
  prompt_tokens?: number | null
  completion_tokens?: number | null
  total_tokens?: number | null
  cost_usd?: number | null
  /** Size of the stored file in bytes. */
  bytes?: number | null
  sites?: { name: string } | null
  articles?: { title: string } | null
}

export interface ArticleEvent {
  id: string
  article_id: string
  kind: 'edited' | 'viewed'
  actor?: string | null
  created_at: string
}

export interface AiUsage {
  id: string
  article_id: string
  step: 'idea' | 'article' | 'seo' | 'image'
  model: string
  total_tokens: number
  /** Null when the cost is genuinely unknown — never treat it as zero. */
  cost_usd: number | null
  created_at: string
}
