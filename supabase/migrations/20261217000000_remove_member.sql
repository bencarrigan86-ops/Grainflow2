-- Taking someone off the farm, which the server was refusing ("new row violates row-level security policy for table farm_users").
--
-- Removing a member stamps deleted_at on their farm_users row (the row stays, so inviting them again brings them straight back).
-- Postgres checks the NEW row of an UPDATE against the SELECT policy as well as the UPDATE policy, and farm_users_select only
-- shows rows where deleted_at is null, so the update that stamps deleted_at failed, for the owner too. This is the same fault as
-- withdrawing an invitation: see 20261118200000_revoke_invitation.sql and 20261111150000_soft_delete_function.sql.
--
-- This does the stamping as the definer, after checking the rule the update policy states (only an owner of the farm), and one
-- more: a farm is never left without an owner. Idempotent: safe to run again.

create or replace function remove_member(p_farm uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if app_role(p_farm) is distinct from 'owner' then
    raise exception 'not allowed';
  end if;

  select role into v_role
    from farm_users
   where farm_id = p_farm and user_id = p_user and deleted_at is null
   limit 1;
  if v_role is null then
    return;                                   -- already off the farm, or never on it: nothing to do
  end if;

  if v_role = 'owner' and not exists (
    select 1 from farm_users
     where farm_id = p_farm and role = 'owner' and deleted_at is null and user_id <> p_user
       and (expires_at is null or expires_at > now())
  ) then
    raise exception 'a farm needs at least one owner. Make someone else an owner first.';
  end if;

  update farm_users set deleted_at = now(), updated_at = now()
   where farm_id = p_farm and user_id = p_user and deleted_at is null;
end;
$$;

revoke all on function remove_member(uuid, uuid) from public;
grant execute on function remove_member(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
