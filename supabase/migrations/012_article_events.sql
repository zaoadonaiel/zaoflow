-- Internal activity trail for an article: who touched it and when.
--
-- Answers "how many times did we edit this, and how often did the client look,
-- before it went live". Never shown to the client — this is the team's view.
create table if not exists article_events (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  -- 'edited' by the team, 'viewed' by the client through their portal.
  kind text not null check (kind in ('edited', 'viewed')),
  -- Display name captured at the time, so renaming a client later does not
  -- rewrite history.
  actor text,
  portal_id uuid references client_portals(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists article_events_article_idx on article_events (article_id, created_at);

alter table article_events enable row level security;

create policy "article_events_owner" on article_events for all using (auth.uid() = user_id);
