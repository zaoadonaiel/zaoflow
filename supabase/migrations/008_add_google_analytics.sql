-- ============================================================
-- GOOGLE ANALYTICS / SEARCH CONSOLE INTEGRATION
-- ============================================================
create table if not exists google_connections (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) on delete cascade unique not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text not null,
  google_email text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists google_connections_user_id_idx on google_connections(user_id);

alter table google_connections enable row level security;

drop policy if exists "google_connections_owner" on google_connections;
create policy "google_connections_owner" on google_connections
  for all using (auth.uid() = user_id);

-- Per-site GA4 / Search Console mapping
alter table sites add column if not exists ga4_property_id text;
alter table sites add column if not exists ga4_measurement_id text;
alter table sites add column if not exists gsc_site_url text;
