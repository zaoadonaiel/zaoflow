-- Prevent duplicate site rows for the same (user, URL).
--
-- Background: the "Add Site" flow in the Analytics tab called POST /api/sites
-- for URLs that already had a row, silently creating a shadow duplicate. The
-- shadow row owned the GA4 mapping but no articles/schedules/etc., so
-- everywhere else in the app the "real" (older) row was still used, which made
-- analytics look connected on some pages and disconnected on others.
--
-- The app normalizes URLs at write time (see src/lib/normalize-site-url.ts):
-- lowercased host, no trailing slash. The index expression here mirrors that
-- so a direct SQL insert (bypassing the app) can't sneak a duplicate past by
-- differing only in case or trailing slashes. We intentionally do *not* fold
-- `www.example.com` into `example.com` — those are legitimately distinct hosts.
create unique index if not exists sites_user_id_url_uniq
  on sites (user_id, lower(regexp_replace(url, '/+$', '')));
