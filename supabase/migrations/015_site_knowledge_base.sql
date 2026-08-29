-- ============================================================
-- SITE KNOWLEDGE BASE
--
-- Free-text background on the company behind a site and the premise everything
-- written for it must sit inside. Read into the prompt on every idea and every
-- article, so it lives on the site rather than per-article.
-- ============================================================
alter table sites
  add column if not exists knowledge_base text not null default '';
