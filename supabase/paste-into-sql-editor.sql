-- Paste ALL of this into the Supabase SQL editor and press Run. Safe to run more than once.

-- Deleting a record, which the server was refusing.
--
-- Nothing here is hard-deleted: removing a paddock, load or silo stamps
-- deleted_at on its row, and every table's SELECT policy only shows rows where
-- deleted_at is null. Postgres checks the *new* row of an UPDATE against the
-- SELECT policy as well as the UPDATE policy, so the update that stamps
-- deleted_at fails with "new row violates row-level security policy" — for
-- everyone, owner included. One refused delete then stopped every other
-- change on the device from being marked as sent.
--
-- This function does the stamping on the caller's behalf, as the definer, after
-- checking the same rule the UPDATE policies state: an owner or manager may
-- remove anyone's record, anyone else only what they created, and only
-- within a farm they belong to.
--
-- Idempotent: safe to run again.

create or replace function soft_delete_row(p_table text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  j jsonb;
  v_farm uuid;
  v_created uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if p_table not in (
    'seasons', 'commodities', 'fields', 'field_agronomy', 'storages', 'sales',
    'sale_terms', 'sale_documents', 'movements', 'movement_legs',
    'movement_photos', 'invoices', 'overheads'
  ) then
    raise exception 'cannot delete from %', p_table;
  end if;

  execute format('select to_jsonb(t) from %I t where t.id = $1', p_table) into j using p_id;
  if j is null then
    return;                                   -- nothing there: nothing to delete
  end if;

  v_farm := nullif(j->>'farm_id', '')::uuid;
  v_created := nullif(j->>'created_by', '')::uuid;

  if v_farm is null or not app_is_member(v_farm) then
    raise exception 'not allowed';
  end if;
  if not (app_role(v_farm) in ('owner', 'manager') or v_created = auth.uid()) then
    raise exception 'not allowed';
  end if;

  execute format('update %I set deleted_at = now() where id = $1 and deleted_at is null', p_table) using p_id;
end;
$$;

revoke all on function soft_delete_row(text, uuid) from public;
grant execute on function soft_delete_row(text, uuid) to authenticated;
