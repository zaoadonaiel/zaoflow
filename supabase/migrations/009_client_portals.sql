-- Client review portals.
--
-- A portal is a long, unguessable URL handed to a client so they can review the
-- articles queued for their site without an account. The 5-digit code shown on
-- the page is a bot/stray-click speed bump, not access control — anyone holding
-- the link can get in, by design.

create table if not exists client_portals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  -- The URL segment. Unique so a lookup by token identifies exactly one portal.
  token text not null unique,
  client_name text,
  -- Revoking a link without deleting its comment history.
  is_active boolean not null default true,
  last_viewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists article_comments (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,
  portal_id uuid references client_portals(id) on delete set null,
  -- Denormalised owner, so the dashboard can list every comment across sites
  -- in one query and RLS has something local to check.
  user_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  -- The first comment on an article is the included revision; anything after it
  -- is chargeable. Stamped at insert so later pricing changes cannot rewrite
  -- what a client was already told.
  is_billable boolean not null default false,
  -- Null until the team marks the revision done.
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists client_portals_token_idx on client_portals (token);
create index if not exists client_portals_user_idx on client_portals (user_id);
create index if not exists article_comments_article_idx on article_comments (article_id);
-- Drives the notification bell: unresolved comments, newest first.
create index if not exists article_comments_open_idx
  on article_comments (user_id, resolved_at, created_at desc);

alter table client_portals enable row level security;
alter table article_comments enable row level security;

-- Dashboard access only. The public portal routes go through the service-role
-- client, which bypasses RLS after validating the token itself.
create policy "client_portals_owner" on client_portals for all using (auth.uid() = user_id);
create policy "article_comments_owner" on article_comments for all using (auth.uid() = user_id);
