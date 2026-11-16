-- Withdrawing an invitation, which the server was refusing.
--
-- Withdrawing stamps deleted_at on the row (the history of who was asked survives, and accept_invitation() skips it).
-- Postgres checks the NEW row of an UPDATE against the SELECT policy as well as the UPDATE policy, and invitations_select
-- only shows rows where deleted_at is null, so the update that stamps deleted_at failed with "new row violates row-level
-- security policy", for the owner too. See 20261111150000_soft_delete_function.sql, the same fault on other tables.
--
-- This does the stamping as the definer, after checking the rule the update policy states: only an owner of the farm
-- the invitation belongs to. Idempotent: safe to run again.

create or replace function revoke_invitation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_farm uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select farm_id into v_farm from invitations where id = p_id and deleted_at is null;
  if v_farm is null then
    return;                                   -- already withdrawn, or never there: nothing to do
  end if;

  if app_role(v_farm) is distinct from 'owner' then
    raise exception 'not allowed';
  end if;

  update invitations set deleted_at = now(), updated_at = now() where id = p_id and deleted_at is null;
end;
$$;

revoke all on function revoke_invitation(uuid) from public;
grant execute on function revoke_invitation(uuid) to authenticated;

notify pgrst, 'reload schema';
