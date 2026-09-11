-- Named presets for the four AI models an article uses: idea, article body,
-- SEO / Yoast, and image. Users hit a combination that reads well and costs
-- little, and want to snap back to it later without re-picking every step.
--
-- Every model column is text, not a FK — OpenRouter's catalogue changes without
-- warning, and a combo referencing a discontinued id should stay in the list
-- (greyed) so the user can substitute rather than lose the preset. The `name`
-- has no uniqueness constraint per user on purpose: duplicate names are a UX
-- concern surfaced in the picker, not a data-integrity one.
create table if not exists model_combos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  idea_model text,
  article_model text,
  seo_model text,
  image_model text,
  created_at timestamptz default now()
);

create index if not exists model_combos_user_created_idx
  on model_combos (user_id, created_at desc);

alter table model_combos enable row level security;

create policy "model_combos_owner"
  on model_combos for all using (auth.uid() = user_id);
