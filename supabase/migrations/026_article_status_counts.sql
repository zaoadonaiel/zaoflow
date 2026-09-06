-- Per-status counts for the articles list header, so each filter button can
-- show how many articles it would surface without a round trip per button.
-- Honors the same site + search filters that /api/articles uses so the
-- counts match what the user would actually see after clicking.
create or replace function get_article_status_counts(
  uid uuid,
  site_filter uuid default null,
  search_filter text default null
) returns table(status text, count bigint)
language sql
stable
as $$
  select status, count(*)::bigint
  from articles
  where user_id = uid
    and (site_filter is null or site_id = site_filter)
    and (search_filter is null or title ilike '%' || search_filter || '%')
  group by status;
$$;
