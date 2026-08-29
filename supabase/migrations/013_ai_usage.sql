-- What each article cost to produce, step by step. Internal only.
create table if not exists ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  -- Null until the article is saved: every generation step happens before the
  -- article row exists, so usage is recorded first and attached on save.
  article_id uuid references articles(id) on delete cascade,
  step text not null check (step in ('idea', 'article', 'seo', 'image')),
  model text not null,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  -- Null when the cost cannot be known -- image models are not priced per
  -- token, and a model missing from the catalogue has no rate to apply.
  cost_usd numeric(12, 6),
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_article_idx on ai_usage (article_id, created_at);
create index if not exists ai_usage_unattached_idx on ai_usage (user_id, article_id);

alter table ai_usage enable row level security;

create policy "ai_usage_owner" on ai_usage for all using (auth.uid() = user_id);
