-- ============================================================
-- SITE IMAGE KNOWLEDGE + REFERENCE IMAGES
--
-- Two things that steer the image generator per site:
--
-- 1. `image_knowledge_base` — free text do/don't rules ("no residential
--    doors", "our owner is a white woman, mid-40s"). Prepended to every
--    image prompt so the generator obeys it even when the caller forgot to.
--
-- 2. `site_reference_images` — the photos the user uploaded so the generator
--    can reproduce the actual owner or brand (logo, headshot, storefront).
--    Each row carries a human description; that description is what the model
--    reads, since OpenRouter's image endpoint does not universally take image
--    inputs. The file itself stays on hand for direct-editing flows and for
--    the user to eyeball what they're referencing.
-- ============================================================

alter table sites
  add column if not exists image_knowledge_base text not null default '';

create table if not exists site_reference_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  -- 'person' = a face we want reproduced (owner, staff);
  -- 'logo'   = a brand mark we want placed;
  -- 'other'  = building shot, product, anything else.
  kind text not null check (kind in ('person', 'logo', 'other')),
  -- Short handle the user recognises the row by in the list ("Owner", "Logo").
  label text not null default '',
  -- The steering text: what the generator should know about this reference.
  description text not null default '',
  url text not null,
  storage_path text,
  bytes integer,
  created_at timestamptz not null default now()
);

create index if not exists site_reference_images_site_idx
  on site_reference_images (site_id, created_at desc);

alter table site_reference_images enable row level security;

drop policy if exists "own reference images" on site_reference_images;
create policy "own reference images"
  on site_reference_images
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
