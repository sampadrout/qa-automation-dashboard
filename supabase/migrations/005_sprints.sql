create table public.sprints (
  id         uuid  primary key default gen_random_uuid(),
  name       text  not null unique,
  start_date date  not null,
  end_date   date  not null,
  sort_order int   not null default 0,
  created_at timestamptz not null default now(),
  constraint sprints_date_check check (end_date >= start_date)
);

alter table public.sprints enable row level security;

create policy "Authenticated users can read sprints"
  on public.sprints for select to authenticated using (true);

create policy "Authenticated users can insert sprints"
  on public.sprints for insert to authenticated with check (true);

create policy "Authenticated users can update sprints"
  on public.sprints for update to authenticated using (true);

create policy "Authenticated users can delete sprints"
  on public.sprints for delete to authenticated using (true);
