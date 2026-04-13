create policy "Authenticated users can delete cycles"
  on public.cycles for delete to authenticated using (true);

create policy "Authenticated users can delete test_results"
  on public.test_results for delete to authenticated using (true);
