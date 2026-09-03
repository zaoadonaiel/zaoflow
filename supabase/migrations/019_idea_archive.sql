-- Ideas that were generated and turned down.
--
-- Regenerating used to throw the idea on screen away: it lived in React state
-- for the length of the session and nowhere else. That is the wrong default —
-- a topic you did not want today is often the one you want next month, and the
-- only way to get it back was to hope the model suggested it again.
--
-- Nothing here is ever written to by the generator twice: an archived idea is a
-- record of a suggestion, and it leaves the table only when it is used.
create table if not exists archived_ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  -- An idea is only meaningful against the site it was written for: the
  -- catalogue and knowledge base it avoided repeating belong to that site.
  site_id uuid not null references sites(id) on delete cascade,
  title text not null,
  description text,
  keywords text[] not null default '{}',
  -- The cost row for the call that produced it. Kept so that restoring the
  -- idea attaches what it already cost to the article it becomes, rather than
  -- leaving the spend orphaned.
  usage_id uuid references ai_usage(id) on delete set null,
  created_at timestamptz not null default now()
);

-- The archive is read newest-first, per site.
create index if not exists archived_ideas_user_idx
  on archived_ideas (user_id, created_at desc);
create index if not exists archived_ideas_site_idx
  on archived_ideas (site_id, created_at desc);

-- The same title turned down twice is one archived idea, not two. Regenerating
-- away from an idea that is already archived must not stack duplicates up.
-- Plain columns rather than lower(title): the insert reaches this through
-- PostgREST's on_conflict, which names columns and cannot name an expression.
create unique index if not exists archived_ideas_title_key
  on archived_ideas (site_id, title);

alter table archived_ideas enable row level security;

drop policy if exists "archived_ideas_owner" on archived_ideas;
create policy "archived_ideas_owner" on archived_ideas for all using (auth.uid() = user_id);
