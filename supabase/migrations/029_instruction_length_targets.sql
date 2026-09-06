-- Length targets on instruction sets, so the article prompt can promote them
-- to a hard rule rather than a soft default the model competes with.
--
-- All three are nullable on purpose. Legacy sets have length written into the
-- free-text `instructions`, and the code falls back to parsing that when the
-- explicit numbers are absent — a null here means "no explicit target set".
alter table article_instructions
  add column if not exists min_words integer,
  add column if not exists target_words integer,
  add column if not exists max_words integer;

alter table article_instructions
  drop constraint if exists article_instructions_length_ordered;

alter table article_instructions
  add constraint article_instructions_length_ordered
  check (
    (min_words is null or min_words > 0) and
    (max_words is null or max_words > 0) and
    (target_words is null or target_words > 0) and
    (min_words is null or max_words is null or min_words <= max_words) and
    (min_words is null or target_words is null or min_words <= target_words) and
    (target_words is null or max_words is null or target_words <= max_words)
  );

-- Which instruction set a schedule uses for its runs. Before this, the trigger
-- task and the manual run route passed no instructions at all, so a user's
-- length/tone/structure rules were silently dropped on every scheduled run.
alter table schedules
  add column if not exists instruction_id uuid references article_instructions(id) on delete set null;
