-- DESTRUCTIVE — run only when you are ready to lose the recurring-schedule rows.
--
-- The recurring generator (schedule-runner / generate-and-publish) has been
-- removed from the app; articles are now scheduled one at a time. Nothing reads
-- this table any more, so it can go. Kept as its own migration because dropping
-- it discards data — the app works fine whether or not you run this one.
--
-- cascade clears the articles.schedule_id foreign key; the column itself stays
-- behind harmlessly and can be dropped separately if you want it gone.
drop table if exists schedules cascade;
