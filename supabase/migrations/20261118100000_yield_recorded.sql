-- A past season imported from the farm's own records has yields that are neither an estimate nor tonnes carted on
-- tickets in the app: they were recorded at the time. Allow a third yield mode, 'recorded', so the rotation history can
-- show those yields as they were and not tag them as estimates. The app works out tonnes from it exactly as it does for
-- an estimate (area x yield), so nothing else about a paddock changes.

do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.field_agronomy'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%yield_mode%'
  loop
    execute format('alter table public.field_agronomy drop constraint %I', c);
  end loop;
end $$;

alter table field_agronomy add constraint field_agronomy_yield_mode_check check (yield_mode in ('estimate', 'actual', 'recorded'));

notify pgrst, 'reload schema';
