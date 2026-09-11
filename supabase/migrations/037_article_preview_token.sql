-- Public preview token for each article.
--
-- The Articles list on the dashboard now offers an "eye" icon that copies a
-- shareable link the team can send to a client — a plain-text preview of the
-- title, the featured image and the body, with no code gate. The token is
-- long and random rather than sequential so the URL cannot be enumerated,
-- and it lives on the article row so revoking it later is a single UPDATE
-- rather than a table join.
--
-- 48 hex characters (24 random bytes) — enough entropy that guessing a valid
-- link is a non-starter, short enough that the URL still fits in a text
-- message.
alter table articles
  add column if not exists preview_token text unique;

-- Backfill every existing article so the eye icon works from the moment the
-- feature ships, rather than only for articles created after the migration.
update articles
set preview_token = encode(gen_random_bytes(24), 'hex')
where preview_token is null;

alter table articles
  alter column preview_token set default encode(gen_random_bytes(24), 'hex'),
  alter column preview_token set not null;
