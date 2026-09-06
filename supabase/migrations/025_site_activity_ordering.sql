-- Order sites by recency and volume of user activity so the picker surfaces
-- the site the user is actually working in. Activity = article creations plus
-- article edit events. Sites with no activity fall back to created_at desc.
create or replace function get_user_sites_ordered(uid uuid)
returns setof sites
language sql
stable
as $$
  with activity as (
    select site_id, created_at
    from articles
    where user_id = uid
    union all
    select a.site_id, e.created_at
    from article_events e
    join articles a on a.id = e.article_id
    where e.user_id = uid and e.kind = 'edited'
  ),
  agg as (
    select site_id,
           max(created_at) as last_activity,
           count(*) as activity_count
    from activity
    group by site_id
  )
  select s.*
  from sites s
  left join agg on agg.site_id = s.id
  where s.user_id = uid
  order by
    agg.last_activity desc nulls last,
    agg.activity_count desc nulls last,
    s.created_at desc;
$$;

create index if not exists articles_user_site_created_idx
  on articles (user_id, site_id, created_at desc);

create index if not exists article_events_user_kind_idx
  on article_events (user_id, kind, created_at desc);
