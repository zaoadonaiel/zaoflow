-- Preserve the source WordPress page's Page Template ("100% Width", "Default",
-- theme-defined templates like Avada's Fusion layouts, etc.) so the clone
-- publishes with the same visual container as the source.
alter table seo_pages
  add column if not exists source_template text;
