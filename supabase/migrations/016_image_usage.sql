-- What each generated image cost, and how big it is.
--
-- The library could already say which model produced an image, but not what it
-- cost or how much storage it takes. Those are recorded per image rather than
-- read back from ai_usage: an image generated before its article was saved has
-- no article_id to join on, so the usage row cannot be found again from here.
--
-- Every column is nullable on purpose. Null means "never recorded" -- true of
-- every image that existed before this migration -- and the library shows that
-- as unknown. A zero would claim the image was free.
alter table generated_images
  add column if not exists prompt_tokens integer,
  add column if not exists completion_tokens integer,
  add column if not exists total_tokens integer,
  add column if not exists cost_usd numeric(12, 6),
  add column if not exists bytes bigint;

-- File size is the one figure that can be recovered for images already stored:
-- the storage layer has kept it all along.
--
-- Deliberately not using the jsonb `?` existence operator here. The Supabase
-- SQL editor runs a script as one transaction, and enough clients read a bare
-- `?` as a bind placeholder that the statement fails -- which rolls back the
-- column creation above with it, leaving the library broken and the columns
-- silently absent. The regex already excludes a missing key, since a null
-- fails it rather than matching.
update generated_images gi
set bytes = (o.metadata->>'size')::bigint
from storage.objects o
where o.bucket_id = 'article-images'
  and o.name = gi.storage_path
  and gi.bytes is null
  and (o.metadata->>'size') ~ '^[0-9]+$';
