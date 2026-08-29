-- Collaboration on an article: versions, a two-sided thread, and a log.
--
-- Until now an article had one body, comments only ever came from the client,
-- and the activity trail recorded two things. All three change once the client
-- can edit: every edit has to be kept, both sides have to be able to speak, and
-- both sides have to be able to see what happened.

-- ------------------------------------------------------------------
-- Versions
-- ------------------------------------------------------------------
-- Every version an article has ever had, whoever wrote it. Nothing here is ever
-- deleted or overwritten -- a draft is a record of what someone wrote, and the
-- point of keeping it is that it survives the next person's edit.
create table if not exists article_drafts (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,
  -- Denormalised owner, so the dashboard can query without a join and RLS has
  -- something local to check.
  user_id uuid not null references profiles(id) on delete cascade,
  -- Which side of the collaboration wrote it. Drives the colour its changes
  -- are shown in, and numbers the drafts separately per side.
  author_side text not null check (author_side in ('team', 'client')),
  -- The name as it read at the time. Captured rather than joined so renaming a
  -- client later does not rewrite the history of who wrote what.
  author_name text not null,
  -- 1, 2, 3 within that side: "The X Digital (Draft 2)".
  number integer not null,
  title text,
  content text not null,
  portal_id uuid references client_portals(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists article_drafts_article_idx
  on article_drafts (article_id, created_at);
create unique index if not exists article_drafts_number_key
  on article_drafts (article_id, author_side, number);

alter table article_drafts enable row level security;

-- Dropped first so the file can be re-run. Everything else here already is
-- idempotent, and a migration that fails halfway on its second run leaves the
-- schema in a state nobody can reason about.
drop policy if exists "article_drafts_owner" on article_drafts;
create policy "article_drafts_owner" on article_drafts for all using (auth.uid() = user_id);

-- ------------------------------------------------------------------
-- A thread with two sides
-- ------------------------------------------------------------------
-- The table held client notes only, so there was nowhere to record who spoke.
-- Existing rows are all from the client, which is what the default says.
alter table article_comments
  add column if not exists author_side text not null default 'client',
  add column if not exists author_name text;

alter table article_comments drop constraint if exists article_comments_side_check;
alter table article_comments
  add constraint article_comments_side_check
  check (author_side in ('team', 'client'));

-- ------------------------------------------------------------------
-- The log
-- ------------------------------------------------------------------
-- Everything that happens to an article, so both sides are looking at the same
-- history rather than each other's summary of it.
alter table article_events drop constraint if exists article_events_kind_check;
alter table article_events
  add constraint article_events_kind_check
  check (kind in (
    'edited', 'viewed', 'reordered',
    'commented', 'drafted', 'paused', 'resumed'
  ));

alter table article_events
  add column if not exists side text;

alter table article_events drop constraint if exists article_events_side_check;
alter table article_events
  add constraint article_events_side_check
  check (side is null or side in ('team', 'client'));

-- Free text for the log line: which draft, or the first words of a comment.
alter table article_events
  add column if not exists detail text;
