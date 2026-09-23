-- ============================================================
-- STATIC SITE DEFAULT CATEGORY — one label written into every
-- article the static publisher commits, so the receiving template
-- can render "Articles" / "Blog" / whatever instead of the
-- "Uncategorized" default. Purely presentational on the static
-- side; Zao Flo does not do anything with the value.
-- ============================================================

alter table sites
  add column if not exists static_default_category text;
