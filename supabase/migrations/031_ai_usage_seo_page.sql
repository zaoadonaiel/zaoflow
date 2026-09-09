-- Cost tracking for SEO Pages: the AI rewrite step and any images generated
-- against a location-cloned page need to hang off the SEO page row so the
-- builder can show what the clone actually cost to produce.
alter table ai_usage
  add column if not exists seo_page_id uuid references seo_pages(id) on delete cascade;

alter table ai_usage drop constraint if exists ai_usage_step_check;
alter table ai_usage
  add constraint ai_usage_step_check
  check (step in ('idea', 'article', 'seo', 'image', 'rewrite'));

create index if not exists ai_usage_seo_page_idx
  on ai_usage (seo_page_id, created_at);
