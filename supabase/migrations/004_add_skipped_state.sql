-- Allow 'skipped' as a valid test state (in addition to passed/failed/pending)
alter table public.test_results
  drop constraint if exists test_results_state_check;

alter table public.test_results
  add constraint test_results_state_check
    check (state in ('passed', 'failed', 'pending', 'skipped'));
