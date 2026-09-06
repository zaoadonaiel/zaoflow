-- The AI model each generator opens with on a fresh article: the one this
-- user has run the most times for that step. Recency breaks ties so a
-- newly-adopted model beats an equally-used legacy one.
create or replace function get_most_used_models(uid uuid)
returns table(step text, model text)
language sql
stable
as $$
  with counts as (
    select step, model,
           count(*) as n,
           max(created_at) as last_used,
           row_number() over (
             partition by step
             order by count(*) desc, max(created_at) desc
           ) as rn
    from ai_usage
    where user_id = uid
      and model is not null
      and model <> ''
    group by step, model
  )
  select step, model from counts where rn = 1;
$$;
