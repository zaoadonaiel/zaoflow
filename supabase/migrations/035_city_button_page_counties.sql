-- ============================================================
-- CITY BUTTONS — cached county assignments for WordPress pages
--
-- The City Buttons picker groups a site's pages into US counties so a
-- 700-page site can be bulk-selected by county ("all 55 LA County
-- pages") instead of one-by-one. County is inferred from the page title
-- by an AI model of the user's choice, so we cache the answer per page
-- to avoid re-running the classifier on every visit — 700 pages is
-- $0.05–$0.50 per pass depending on the model.
--
-- Keyed by (site_id, wp_page_id) so a new page added to WordPress
-- appears as "unassigned" on the next load and only that delta is sent
-- to the model. `county`/`state` are text (not FKs) because the model
-- writes free-form values ("Los Angeles County", "CA") that we compare
-- as strings — no separate counties table is worth the complexity.
-- ============================================================

create table if not exists page_counties (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  site_id uuid references sites(id) on delete cascade not null,
  wp_page_id bigint not null,

  -- Free-form because the model writes them. Nullable so a "don't know"
  -- answer is representable without deleting the row (which would just
  -- put the page back in the queue on the next run).
  county text,
  state text,

  -- Snapshot at classification time — lets the picker show the label
  -- the model actually classified against, even if the WP page is later
  -- renamed. Small strings, cheap to store.
  wp_page_title text,
  wp_page_slug text,

  ai_model text,

  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,

  unique (site_id, wp_page_id)
);

create index if not exists page_counties_site_id_idx on page_counties(site_id);
create index if not exists page_counties_user_id_idx on page_counties(user_id);

alter table page_counties enable row level security;
create policy "page_counties_owner" on page_counties for all using (auth.uid() = user_id);
