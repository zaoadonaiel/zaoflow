-- Autopilot: hands-off, continuous article generation and scheduling per site.
--
-- A site is in one of three states — off (nothing happens), on (a background
-- tick keeps three articles queued in the next 72 h and refills as they
-- publish), or paused (already-scheduled articles still publish but no new
-- ones are generated). "On" is only valid when a model combo has been
-- picked, since the tick needs to know which four models to run the
-- pipeline with. That combo requirement is enforced at the API layer rather
-- than as a table constraint so a `model_combos` cascade doesn't silently
-- leave a site in an inconsistent on-without-combo state that no read path
-- surfaces.
--
-- No new "autopilot articles" table: an autopilot article is an ordinary
-- articles row with `source = 'autopilot'`. That way the editor, the
-- publish-due cron, the delete flow, and every other article-aware piece of
-- the app treat it exactly like a manual one.

alter table sites
  add column if not exists autopilot_enabled boolean not null default false,
  add column if not exists autopilot_paused boolean not null default false,
  add column if not exists autopilot_model_combo_id uuid references model_combos(id) on delete set null;

alter table articles
  add column if not exists source text not null default 'manual'
    check (source in ('manual', 'autopilot'));

-- Autopilot's tick reads "how many upcoming articles does this site already
-- have queued" every hour. Without this the query walks every row for the
-- site — fine at ten posts, painful at a thousand.
create index if not exists articles_autopilot_upcoming_idx
  on articles (site_id, scheduled_at)
  where source = 'autopilot' and status in ('scheduled', 'draft');
