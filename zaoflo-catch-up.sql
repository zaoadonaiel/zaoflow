-- ============================================================
-- Zaoflo catch-up: migrations 005, 007, 009-013 and 015
-- Safe to run whether or not any of it is already applied.
-- Does not touch existing data. 008 is deliberately excluded.
--
-- 014 (generated_images) is NOT here: it carries a storage backfill and is
-- unrelated to anything below. Run supabase/migrations/014_generated_images.sql
-- on its own for the Image Library.
-- ============================================================

-- 005 — SEO and image fields.
--
-- The client portal is the only query that names its columns instead of
-- selecting *, so it is the only thing that hard-fails when one of these is
-- missing: the whole link returns "These articles could not be loaded."
alter table articles
  add column if not exists featured_image_url text,
  add column if not exists featured_image_prompt text,
  add column if not exists focus_keyphrase text,
  add column if not exists keyphrase_synonyms text,
  add column if not exists yoast_title text,
  add column if not exists yoast_meta_description text,
  add column if not exists slug text;

alter table api_settings
  add column if not exists openai_api_key text;

-- 007 — per-article scheduling controls
alter table articles add column if not exists is_paused boolean not null default false;
alter table articles add column if not exists archived_at timestamptz;
alter table articles add column if not exists scheduled_tz text;

create index if not exists articles_site_status_idx on articles (site_id, status);
create index if not exists articles_user_archived_idx on articles (user_id, archived_at);

-- 010 — first time the client opened an article.
-- This is the column the portal was actually dying on (42703).
alter table articles add column if not exists client_viewed_at timestamptz;

-- 009 — client review portals
create table if not exists client_portals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  token text not null unique,
  client_name text,
  is_active boolean not null default true,
  last_viewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists article_comments (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,
  portal_id uuid references client_portals(id) on delete set null,
  user_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  is_billable boolean not null default false,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists client_portals_token_idx on client_portals (token);
create index if not exists client_portals_user_idx on client_portals (user_id);
create index if not exists article_comments_article_idx on article_comments (article_id);
create index if not exists article_comments_open_idx
  on article_comments (user_id, resolved_at, created_at desc);

-- 011 — one row per time a client passed the code gate
create table if not exists portal_opens (
  id uuid primary key default gen_random_uuid(),
  portal_id uuid not null references client_portals(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  opened_at timestamptz not null default now()
);

create index if not exists portal_opens_portal_idx on portal_opens (portal_id, opened_at desc);

-- 012 — internal edit/view trail
create table if not exists article_events (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('edited', 'viewed')),
  actor text,
  portal_id uuid references client_portals(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists article_events_article_idx on article_events (article_id, created_at);

-- 013 — what each article cost to produce
create table if not exists ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  article_id uuid references articles(id) on delete cascade,
  step text not null check (step in ('idea', 'article', 'seo', 'image')),
  model text not null,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  cost_usd numeric(12, 6),
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_article_idx on ai_usage (article_id, created_at);
create index if not exists ai_usage_unattached_idx on ai_usage (user_id, article_id);

-- Row level security. Postgres has no "create policy if not exists", so each is
-- dropped first — this is what makes the whole script safe to re-run.
alter table client_portals  enable row level security;
alter table article_comments enable row level security;
alter table portal_opens    enable row level security;
alter table article_events  enable row level security;
alter table ai_usage        enable row level security;

drop policy if exists "client_portals_owner"  on client_portals;
drop policy if exists "article_comments_owner" on article_comments;
drop policy if exists "portal_opens_owner"    on portal_opens;
drop policy if exists "article_events_owner"  on article_events;
drop policy if exists "ai_usage_owner"        on ai_usage;

create policy "client_portals_owner"   on client_portals   for all using (auth.uid() = user_id);
create policy "article_comments_owner" on article_comments for all using (auth.uid() = user_id);
create policy "portal_opens_owner"     on portal_opens     for all using (auth.uid() = user_id);
create policy "article_events_owner"   on article_events   for all using (auth.uid() = user_id);
create policy "ai_usage_owner"         on ai_usage         for all using (auth.uid() = user_id);


-- 015 — the per-site knowledge base.
--
-- Company background and premise, read into the prompt before every idea and
-- every article. Missing, the knowledge base panel loads empty and the AI
-- writes with no idea whose site it is writing for.
alter table sites add column if not exists knowledge_base text not null default '';
