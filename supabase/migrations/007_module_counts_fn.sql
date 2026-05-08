-- Returns the actual test count per module for every cycle.
-- Used by the PDF "Latest Runs — Total Tests Per Module" table so the
-- numbers match real test execution counts, not just distinct first-seen titles.
create or replace function public.get_module_counts_per_cycle()
returns table (
  cycle_id   uuid,
  module     text,
  test_count bigint
)
language sql
security definer
set search_path = public
as $$
  select
    tr.cycle_id,
    coalesce(tr.module, '(none)') as module,
    count(*) as test_count
  from public.test_results tr
  join public.cycles c on c.id = tr.cycle_id
  where c.status = 'ready'
    and tr.state is not null
  group by tr.cycle_id, tr.module;
$$;

grant execute on function public.get_module_counts_per_cycle() to authenticated;
