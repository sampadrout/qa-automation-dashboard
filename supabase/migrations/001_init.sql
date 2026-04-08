-- Enable pgcrypto for gen_random_uuid()
create extension if not exists pgcrypto;

-- ─── cycles ──────────────────────────────────────────────────────────────────
create table public.cycles (
  id            uuid        primary key default gen_random_uuid(),
  name          text        not null unique,
  uploaded_at   timestamptz not null default now(),
  uploaded_by   uuid        references auth.users(id) on delete set null,
  status        text        not null default 'processing'
                            check (status in ('processing', 'ready', 'error')),
  total_tests   int         not null default 0,
  passed        int         not null default 0,
  failed        int         not null default 0,
  pending       int         not null default 0,
  error_message text
);

alter table public.cycles enable row level security;

create policy "Authenticated users can read cycles"
  on public.cycles for select to authenticated using (true);

create policy "Authenticated users can insert cycles"
  on public.cycles for insert to authenticated with check (true);

create policy "Authenticated users can update cycles"
  on public.cycles for update to authenticated using (true);

-- ─── test_results ─────────────────────────────────────────────────────────────
create table public.test_results (
  id           uuid        primary key default gen_random_uuid(),
  cycle_id     uuid        not null references public.cycles(id) on delete cascade,
  row_num      int,
  module       text,
  file         text,
  suites       text,
  test_title   text,
  full_title   text,
  state        text        check (state in ('passed', 'failed', 'pending')),
  duration_s   numeric,
  error        text,
  triage_type  text,
  triage_desc  text,
  triaged_by   uuid        references auth.users(id) on delete set null,
  triaged_at   timestamptz
);

create index idx_test_results_cycle_id on public.test_results(cycle_id);
create index idx_test_results_state    on public.test_results(state);
create index idx_test_results_module   on public.test_results(module);

alter table public.test_results enable row level security;

create policy "Authenticated users can read test_results"
  on public.test_results for select to authenticated using (true);

create policy "Authenticated users can insert test_results"
  on public.test_results for insert to authenticated with check (true);

create policy "Authenticated users can update triage"
  on public.test_results for update to authenticated
  using (true)
  with check (true);
