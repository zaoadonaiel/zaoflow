-- The client can now reorder their own queue from the portal, which is a third
-- thing that happens to an article and belongs in the same activity trail.
alter table article_events drop constraint if exists article_events_kind_check;

alter table article_events
  add constraint article_events_kind_check
  check (kind in ('edited', 'viewed', 'reordered'));
