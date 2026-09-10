-- ============================================================
-- AUTO POST — bulk city runs for SEO Pages
--
-- Three tables:
--  * city_lists      — a saved CSV of target cities, extracted from a Word
--                      doc by an AI model. Reusable across many runs.
--  * city_list_runs  — one row per "run this list against a source page"
--                      job. Progress counters live here so the UI can poll
--                      one row for a summary.
--  * city_list_run_items — per-city status: pending → running → published,
--                      or failed. Rendered as the progress list under a run.
-- ============================================================

create table if not exists city_lists (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  name text not null,
  source_filename text,
  -- The extracted CSV — small enough (a few KB even for hundreds of
  -- cities) that a text column beats a storage bucket lookup on every
  -- run kickoff.
  csv_content text not null,
  city_count int not null default 0,
  ai_model text,
  created_at timestamptz default now() not null
);

create index if not exists city_lists_user_id_idx on city_lists(user_id);

alter table city_lists enable row level security;
create policy "city_lists_owner" on city_lists for all using (auth.uid() = user_id);


create table if not exists city_list_runs (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  city_list_id uuid references city_lists(id) on delete set null,
  site_id uuid references sites(id) on delete cascade not null,

  -- Everything needed to reproduce the run — kept flat on the row so the
  -- Trigger task doesn't need extra lookups per city and the UI can show
  -- what was configured without joining back to the list.
  source_kind text not null check (source_kind in ('post', 'page')),
  source_page_id bigint not null,
  source_city text not null,
  ai_model text,
  instruction_id uuid,
  rewrite_similarity int check (rewrite_similarity in (10, 25, 50, 90)),
  city_only_mode boolean not null default false,
  override_existing boolean not null default true,
  set_location_meta boolean not null default true,

  total int not null default 0,
  succeeded int not null default 0,
  failed int not null default 0,

  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  error text,
  trigger_run_id text,

  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists city_list_runs_user_id_idx on city_list_runs(user_id);
create index if not exists city_list_runs_status_idx on city_list_runs(status);

alter table city_list_runs enable row level security;
create policy "city_list_runs_owner" on city_list_runs for all using (auth.uid() = user_id);


create table if not exists city_list_run_items (
  id uuid default uuid_generate_v4() primary key,
  run_id uuid references city_list_runs(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,

  position int not null,
  target_city text not null,

  seo_page_id uuid references seo_pages(id) on delete set null,
  wp_page_url text,

  status text not null default 'pending'
    check (status in ('pending', 'running', 'published', 'failed', 'skipped')),
  error text,

  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now() not null
);

create index if not exists city_list_run_items_run_id_idx on city_list_run_items(run_id, position);
create index if not exists city_list_run_items_user_id_idx on city_list_run_items(user_id);

alter table city_list_run_items enable row level security;
create policy "city_list_run_items_owner" on city_list_run_items for all using (auth.uid() = user_id);
