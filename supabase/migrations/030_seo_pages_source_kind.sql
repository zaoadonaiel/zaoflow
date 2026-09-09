-- Lets the SEO Pages tool clone either a WordPress post or a page.
-- Older rows all cloned posts, so the default keeps their behaviour.
alter table seo_pages
  add column if not exists source_kind text not null default 'post'
    check (source_kind in ('post', 'page'));
