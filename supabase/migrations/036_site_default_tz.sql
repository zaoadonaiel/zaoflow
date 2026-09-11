-- Per-site default timezone for scheduling.
--
-- Every article the user schedules for a given site was landing on 'PST'
-- until they opened the picker and switched it, even when the site itself
-- operates in a different zone (e.g. Maui Cruisers, which lives in HST).
-- Storing the site's own zone makes the picker seed correctly on new
-- articles and lets the random-morning-slot logic roll a slot in the zone
-- that actually matches the site.
--
-- Values are the same short IDs the scheduler already uses:
--   HST, PST, MT, CT, EST — matching SCHEDULE_ZONES in src/lib/timezone.ts.
alter table sites
  add column if not exists default_tz text not null default 'PST'
    check (default_tz in ('HST', 'PST', 'MT', 'CT', 'EST'));
