-- Enable UUID extension
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ============================================================
-- PROFILES
-- ============================================================
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ============================================================
-- SITES
-- ============================================================
create table if not exists sites (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  name text not null,
  url text not null,
  wp_username text not null,
  wp_app_password text not null,
  secret_token text not null default encode(gen_random_bytes(32), 'hex'),
  status text not null default 'disconnected'
    check (status in ('connected', 'disconnected', 'error')),
  plugin_installed boolean not null default false,
  last_sync timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ============================================================
-- API SETTINGS (one per user)
-- ============================================================
create table if not exists api_settings (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) on delete cascade unique not null,
  openrouter_api_key text,
  default_model text not null default 'anthropic/claude-3-5-sonnet',
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ============================================================
-- ARTICLES
-- ============================================================
create table if not exists articles (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  site_id uuid references sites(id) on delete cascade not null,
  title text not null,
  content text not null default '',
  excerpt text,
  meta_description text,
  keywords text[] default '{}',
  focus_keyword text,
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'publishing', 'published', 'failed')),
  scheduled_at timestamptz,
  published_at timestamptz,
  wp_post_id bigint,
  wp_post_url text,
  ai_model text,
  word_count int,
  trigger_job_id text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ============================================================
-- SCHEDULES
-- ============================================================
create table if not exists schedules (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  site_id uuid references sites(id) on delete cascade not null,
  name text not null,
  frequency text not null
    check (frequency in ('daily', 'every_48h', 'weekly', 'twice_monthly', 'monthly', 'custom')),
  custom_cron text,
  time_of_day text not null default '09:00',
  timezone text not null default 'UTC',
  is_active boolean not null default true,
  next_run timestamptz,
  last_run timestamptz,
  articles_generated int not null default 0,
  ai_model text not null default 'anthropic/claude-3-5-sonnet',
  topic_prompt text not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ============================================================
-- PUBLISH LOGS
-- ============================================================
create table if not exists publish_logs (
  id uuid default uuid_generate_v4() primary key,
  article_id uuid references articles(id) on delete cascade not null,
  site_id uuid references sites(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  status text not null check (status in ('success', 'failed', 'pending')),
  error_message text,
  wp_post_id bigint,
  wp_post_url text,
  created_at timestamptz default now() not null
);

-- ============================================================
-- INDEXES
-- ============================================================
create index if not exists articles_user_id_idx on articles(user_id);
create index if not exists articles_site_id_idx on articles(site_id);
create index if not exists articles_status_idx on articles(status);
create index if not exists schedules_user_id_idx on schedules(user_id);
create index if not exists schedules_next_run_idx on schedules(next_run) where is_active = true;
create index if not exists publish_logs_user_id_idx on publish_logs(user_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table profiles enable row level security;
alter table sites enable row level security;
alter table api_settings enable row level security;
alter table articles enable row level security;
alter table schedules enable row level security;
alter table publish_logs enable row level security;

-- Profiles
create policy "profiles_self" on profiles for all using (auth.uid() = id);

-- Sites
create policy "sites_owner" on sites for all using (auth.uid() = user_id);

-- API Settings
create policy "api_settings_owner" on api_settings for all using (auth.uid() = user_id);

-- Articles
create policy "articles_owner" on articles for all using (auth.uid() = user_id);

-- Schedules
create policy "schedules_owner" on schedules for all using (auth.uid() = user_id);

-- Publish logs
create policy "publish_logs_owner" on publish_logs for all using (auth.uid() = user_id);

-- Service role bypass (for Trigger.dev / server-side operations)
-- Service role key bypasses RLS automatically in Supabase

-- ============================================================
-- TRIGGER: auto-create profile + api_settings on signup
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;

  insert into public.api_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- HELPER: increment integer column safely
-- ============================================================
create or replace function increment(x int)
returns int as $$
  select x + 1
$$ language sql immutable;
