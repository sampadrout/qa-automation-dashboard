-- Distinguish smoke-test runs (from the CI pipeline) from curated regression cycles.
-- Smoke runs live in the same tables but are surfaced in a dedicated tab and are
-- excluded from the regression analytics/RPCs below.
alter table public.cycles
  add column if not exists kind text not null default 'regression'
  check (kind in ('regression', 'smoke'));

create index if not exists idx_cycles_kind on public.cycles(kind);

-- ── Recreate analytics RPCs so smoke runs never contaminate regression trends ──

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
    and c.kind = 'regression'
  order by tr.test_title, c.name;
$$;

grant execute on function public.get_title_first_seen() to authenticated;

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
    and c.kind = 'regression'
    and tr.state is not null
  group by tr.cycle_id, tr.module;
$$;

grant execute on function public.get_module_counts_per_cycle() to authenticated;
