-- Every image ever generated, so the Image Library can show them all.
--
-- Until now an image only survived as articles.featured_image_url, which keeps
-- exactly one image per article: regenerate and the earlier one stayed in
-- storage with nothing pointing at it. This table records each generation as it
-- happens, and the backfill below recovers everything already in the bucket.
create table if not exists generated_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  -- Both null for an image generated before its article was ever saved, and
  -- article_id is cleared rather than cascaded so deleting an article does not
  -- destroy the record of what was produced for it.
  article_id uuid references articles(id) on delete set null,
  site_id uuid references sites(id) on delete set null,
  prompt text,
  model text,
  -- The public URL. Null on rows recovered from storage, where the project URL
  -- is not knowable from SQL -- the app rebuilds those from storage_path.
  url text,
  -- Path inside the article-images bucket, e.g. "<user>/1755620000000.png".
  storage_path text,
  created_at timestamptz not null default now()
);

-- One row per stored file, so a re-run of the backfill is a no-op.
create unique index if not exists generated_images_path_key
  on generated_images (storage_path) where storage_path is not null;
create index if not exists generated_images_user_idx
  on generated_images (user_id, created_at desc);
create index if not exists generated_images_site_idx
  on generated_images (site_id, created_at desc);

alter table generated_images enable row level security;

create policy "generated_images_owner" on generated_images for all using (auth.uid() = user_id);

-- Backfill 1: images currently attached to an article, which carry the prompt
-- and the site the article belongs to.
insert into generated_images (user_id, article_id, site_id, prompt, url, storage_path, created_at)
select
  a.user_id,
  a.id,
  a.site_id,
  a.featured_image_prompt,
  a.featured_image_url,
  substring(a.featured_image_url from '/article-images/(.+)$'),
  coalesce(a.updated_at, a.created_at)
from articles a
where a.featured_image_url is not null
  and a.featured_image_url <> ''
  and substring(a.featured_image_url from '/article-images/(.+)$') is not null
on conflict (storage_path) where storage_path is not null do nothing;

-- Backfill 2: everything else in the bucket -- images that were regenerated
-- over, or generated on an article that was never saved. The owner is the first
-- path segment, which is how the upload names them.
--
-- The uuid cast lives in its own materialized CTE so it only ever sees paths
-- that already matched the pattern; folded into one query, the planner is free
-- to cast a stray path before filtering it out and the whole insert fails.
with candidates as materialized (
  select o.name, o.created_at
  from storage.objects o
  where o.bucket_id = 'article-images'
    and split_part(o.name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
)
insert into generated_images (user_id, storage_path, created_at)
select
  split_part(c.name, '/', 1)::uuid,
  c.name,
  coalesce(c.created_at, now())
from candidates c
where exists (
  select 1 from profiles p where p.id = split_part(c.name, '/', 1)::uuid
)
on conflict (storage_path) where storage_path is not null do nothing;
