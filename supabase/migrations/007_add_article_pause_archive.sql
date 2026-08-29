-- Per-article scheduling controls for the Schedules page.
-- is_paused  : article keeps its scheduled_at but must not go live on WordPress.
-- archived_at: article is hidden from the working lists and shown under Archive.
-- scheduled_tz: which of HST/PST/CT/EST the time was picked in, so the calendar
--               modal can reopen showing the same reading the user chose.
alter table articles add column if not exists is_paused boolean not null default false;
alter table articles add column if not exists archived_at timestamptz;
alter table articles add column if not exists scheduled_tz text;

-- The Schedules page always filters by site + status, and every list excludes
-- archived rows, so both lookups get an index.
create index if not exists articles_site_status_idx on articles (site_id, status);
create index if not exists articles_user_archived_idx on articles (user_id, archived_at);
