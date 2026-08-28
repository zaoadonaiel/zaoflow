-- ============================================================
-- NODE.JS SITES — second site type alongside WordPress, using a
-- push model where Zao Flo posts to the target site's own API.
-- Reuses sites.secret_token (already generated per-site) as the
-- Node.js API bearer key — no new secret column needed.
-- ============================================================

-- Site type discriminator
alter table sites
  add column if not exists site_type text not null default 'wordpress'
  check (site_type in ('wordpress', 'nodejs'));

-- WordPress credentials are no longer required for every site
alter table sites alter column wp_username drop not null;
alter table sites alter column wp_app_password drop not null;

-- Node.js sites need the URL of their deployed /api/zaoflo/* routes
alter table sites
  add column if not exists node_api_url text;

-- Make sure each site type has the fields it actually needs
alter table sites
  drop constraint if exists sites_site_type_fields_check;
alter table sites
  add constraint sites_site_type_fields_check
  check (
    (site_type = 'wordpress' and wp_username is not null and wp_app_password is not null)
    or
    (site_type = 'nodejs' and node_api_url is not null)
  );

-- Node.js publish results, mirroring wp_post_id / wp_post_url
alter table articles
  add column if not exists node_post_id text,
  add column if not exists node_post_url text;

alter table publish_logs
  add column if not exists node_post_id text,
  add column if not exists node_post_url text;
