-- New status for an article whose body is being written by a Trigger.dev
-- background task. The row exists as soon as generation starts so that
-- closing the tab is not a lost article — the task keeps running in the
-- cloud and rewrites the row to 'draft' when it finishes.
alter table articles drop constraint if exists articles_status_check;
alter table articles add constraint articles_status_check
  check (status in ('draft', 'generating', 'scheduled', 'publishing', 'published', 'failed'));
