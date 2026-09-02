-- Publishing was tied to whichever WordPress user's Application Password is
-- stored on the site — if that account's access changes, publishing breaks,
-- and there was no way to publish as a different author regardless of which
-- account authorized the connection. This decouples "who authorizes the
-- connection" from "who the post is attributed to".
alter table sites add column if not exists wp_authors jsonb not null default '[]'::jsonb;
alter table sites add column if not exists wp_default_author_id integer;
