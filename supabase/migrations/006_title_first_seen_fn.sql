-- Returns one row per distinct test_title: its first occurrence ordered by cycle name.
-- This replaces the old paginated full-table scan in fetchAllTitles and reduces
-- the data transfer from (cycles × tests) rows down to just (distinct test titles).
create or replace function public.get_title_first_seen()
returns table (
  cycle_id   uuid,
  test_title text,
  module     text
)
language sql
security definer
set search_path = public
as $$
  select distinct on (tr.test_title)
    tr.cycle_id,
    tr.test_title,
    tr.module
  from public.test_results tr
  join public.cycles c on c.id = tr.cycle_id
  where tr.test_title is not null
    and c.status = 'ready'
  order by tr.test_title, c.name;
$$;

grant execute on function public.get_title_first_seen() to authenticated;
