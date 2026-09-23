-- ============================================================
-- STATIC SITES — fourth site_type alongside wordpress/nodejs/other.
-- Zao Flo commits the article into a JSON file inside a GitHub
-- repo; the host (Cloudflare Pages/Netlify/Vercel) rebuilds on
-- push. No receiver runs on the static site itself.
--
-- The JSON file is shaped { "<lang>": { "articles": [...] } } so
-- each site picks a default language bucket at connection time.
-- ============================================================

-- Widen the site_type enum
alter table sites
  drop constraint if exists sites_site_type_check;

alter table sites
  add constraint sites_site_type_check
  check (site_type in ('wordpress', 'nodejs', 'other', 'static'));

-- Static-site connection fields. github_token is a fine-grained
-- PAT with contents:write on one repo; stored plaintext to match
-- wp_app_password and secret_token in this schema.
alter table sites
  add column if not exists github_repo text,
  add column if not exists github_branch text not null default 'main',
  add column if not exists github_token text,
  add column if not exists github_content_path text not null default 'content/articles.json',
  add column if not exists github_default_language text not null default 'en';

-- Static sites need repo + token to publish; other types keep their
-- existing requirements.
alter table sites
  drop constraint if exists sites_site_type_fields_check;

alter table sites
  add constraint sites_site_type_fields_check
  check (
    (site_type = 'wordpress' and wp_username is not null and wp_app_password is not null)
    or
    (site_type = 'nodejs' and node_api_url is not null)
    or
    (site_type = 'static' and github_repo is not null and github_token is not null)
    or
    (site_type = 'other')
  );

-- Static publish results. The slug is the natural id since we edit
-- an entry inside a JSON file rather than a per-post row on a CMS;
-- the URL is the eventual public path once the rebuild finishes.
alter table articles
  add column if not exists static_post_slug text,
  add column if not exists static_post_url text;

alter table publish_logs
  add column if not exists static_post_slug text,
  add column if not exists static_post_url text;
