-- Every record now remembers who first saved it.
--
-- created_by was declared on the farm's tables and then never filled in: no default, no trigger, and the app never sends it. Every
-- row had it empty (on the live farm, 0 of 664 loads had one), so each rule that asks "is this the person's own record?" saw nobody:
--   * the "drivers see only their own loads" switch would show a driver no loads at all,
--   * a driver or farm worker could not delete a load or paddock they had entered themselves,
--   * a bookkeeper could not edit a contract or invoice they had entered themselves.
-- The tables made later (input stock, spray requests, documents) already default it to the signed-in person; this does the same for
-- the rest. A new row is stamped with whoever saves it first, and a later edit by someone else leaves it alone.
--
-- Rows saved before this keep it empty, which is the careful direction: the owner and managers can still change them (the rules
-- say "owner or manager, or the person who made it"), and a driver on "own loads only" does not see loads entered before the
-- switch could work. Nothing is changed on existing rows, so no load, contract or invoice is touched or looks edited to the sync.
--
-- Safe to run more than once: only columns with no default yet are changed.

do $$
declare
  t record;
begin
  for t in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables s
        on s.table_schema = c.table_schema and s.table_name = c.table_name and s.table_type = 'BASE TABLE'
     where c.table_schema = 'public'
       and c.column_name = 'created_by'
       and c.data_type = 'uuid'
       and c.column_default is null
  loop
    execute format('alter table public.%I alter column created_by set default auth.uid()', t.table_name);
  end loop;
end $$;

notify pgrst, 'reload schema';
