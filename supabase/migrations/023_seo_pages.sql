-- ============================================================
-- SEO PAGES
-- Location-cloned WordPress *pages* (not posts). One draft row per
-- generated city variant; the WP page id is filled in after publish.
-- ============================================================
create table if not exists seo_pages (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  site_id uuid references sites(id) on delete cascade not null,

  -- Source: the existing WP page that seeded this draft.
  source_page_id bigint,
  source_slug text,
  source_title text,

  -- What the tool swapped: "Los Angeles" → "San Diego" in the body,
  -- "los-angeles-ca" → "san-diego-ca" in the slug.
  source_city text,
  target_city text,

  -- The generated draft.
  title text not null,
  slug text,
  content text not null default '',
  excerpt text,

  featured_image_url text,
  featured_image_prompt text,
  featured_image_alt text,

  focus_keyphrase text,
  keyphrase_synonyms text,
  yoast_title text,
  yoast_meta_description text,

  -- Rewrite step: which model, which similarity band.
  ai_model text,
  instruction_id uuid,
  rewrite_similarity int check (rewrite_similarity in (10, 25, 50, 90)),

  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'publishing', 'published', 'failed')),
  scheduled_at timestamptz,
  scheduled_tz text,
  published_at timestamptz,

  -- The WP page (not post) this draft became after publish.
  wp_page_id bigint,
  wp_page_url text,

  trigger_job_id text,

  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists seo_pages_user_id_idx on seo_pages(user_id);
create index if not exists seo_pages_site_id_idx on seo_pages(site_id);
create index if not exists seo_pages_status_idx on seo_pages(status);

alter table seo_pages enable row level security;
create policy "seo_pages_owner" on seo_pages for all using (auth.uid() = user_id);
