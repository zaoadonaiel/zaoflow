-- SEO and image fields for articles
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS featured_image_url text,
  ADD COLUMN IF NOT EXISTS featured_image_prompt text,
  ADD COLUMN IF NOT EXISTS focus_keyphrase text,
  ADD COLUMN IF NOT EXISTS keyphrase_synonyms text,
  ADD COLUMN IF NOT EXISTS yoast_title text,
  ADD COLUMN IF NOT EXISTS yoast_meta_description text,
  ADD COLUMN IF NOT EXISTS slug text;

-- OpenAI API key for image generation
ALTER TABLE api_settings
  ADD COLUMN IF NOT EXISTS openai_api_key text;
