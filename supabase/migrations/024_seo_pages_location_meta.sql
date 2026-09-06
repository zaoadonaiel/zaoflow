-- Admin toggle for the WordPress `_location` post meta written when an
-- SEO page publishes. `true` → the post gets `_location = 1`;
-- `false` → the post gets `_location = ''` (still written, just empty).
alter table seo_pages
  add column if not exists set_location_meta boolean not null default true;
