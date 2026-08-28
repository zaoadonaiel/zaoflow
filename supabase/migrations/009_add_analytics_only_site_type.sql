-- ============================================================
-- ANALYTICS-ONLY SITES — a third site_type for sites that are
-- tracked in the Analytics tab but not connected for publishing
-- (no WordPress credentials, no Node.js API URL required).
-- ============================================================

alter table sites
  drop constraint if exists sites_site_type_fields_check;

alter table sites
  drop constraint if exists sites_type_fields_check;

alter table sites
  add constraint sites_site_type_fields_check
  check (
    (site_type = 'wordpress' and wp_username is not null and wp_app_password is not null)
    or
    (site_type = 'nodejs' and node_api_url is not null)
    or
    (site_type = 'other')
  );

-- Widen the site_type enum to include 'other'
alter table sites
  drop constraint if exists sites_site_type_check;

alter table sites
  add constraint sites_site_type_check
  check (site_type in ('wordpress', 'nodejs', 'other'));
