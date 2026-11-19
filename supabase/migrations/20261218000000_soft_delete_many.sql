-- Deleting many records in one call.
--
-- Clearing a sample farm, or a whole season, deletes hundreds of rows. The app was sending each as two requests (the plain update the
-- server always refuses, then soft_delete_row), one after another: a phone on a weak signal took minutes, and the Settings screen
-- said "Not yet on the server" for all of that time.
--
-- This takes a table and a list of ids and applies soft_delete_row to each, so every rule it holds (who may delete what, owner only
-- for a season, the farm's own delete switch) applies exactly as before. If any one of them is refused the whole call is refused and
-- nothing in it is deleted; the app then falls back to one at a time, so the one that is stuck is named. At most 200 ids at a time.
-- Idempotent: safe to run again.

create or replace function soft_delete_rows(p_table text, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 200 then
    raise exception 'too many at once';
  end if;
  foreach v_id in array coalesce(p_ids, '{}'::uuid[]) loop
    perform soft_delete_row(p_table, v_id);
  end loop;
end;
$$;

revoke all on function soft_delete_rows(text, uuid[]) from public;
grant execute on function soft_delete_rows(text, uuid[]) to authenticated;

notify pgrst, 'reload schema';
