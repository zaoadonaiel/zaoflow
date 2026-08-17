-- ============================================================
-- ARTICLE INSTRUCTIONS — reusable AI instruction sets per user
-- Replaces the hardcoded word-count presets on the New Article page
-- ============================================================
create table if not exists article_instructions (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  name text not null,
  instructions text not null default '',
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists article_instructions_user_id_idx
  on article_instructions(user_id);

alter table article_instructions enable row level security;

drop policy if exists "article_instructions_owner" on article_instructions;
create policy "article_instructions_owner" on article_instructions
  for all using (auth.uid() = user_id);
