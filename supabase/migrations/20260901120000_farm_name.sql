-- The property and the entity are two different names.
--
-- farms.entity_name has been doing both jobs since the first migration: it is
-- the Seller on an invoice *and* the name the app calls the farm. Those are not
-- the same thing on a family farm. Sunnyridge is the property; the ABN is held
-- by a Pty Ltd with a different name; and whichever one went in that column was
-- wrong everywhere the other one was shown.
--
-- So: a second column, and a backfill so no farm goes nameless in the interim.

alter table farms add column if not exists farm_name text;

-- Every existing farm has been calling its entity name the farm name, so that
-- is the correct starting value — the owner then separates them in Settings.
-- Guarded so re-running this cannot overwrite a name somebody has since set.
update farms
   set farm_name = entity_name
 where farm_name is null
   and coalesce(entity_name, '') <> '';

-- ---------------------------------------------------------------------------
-- accept_invitation, returning the property name rather than the entity
--
-- Identical to the version in 20260901100000_invitations.sql except for the
-- final select: an invitation says "you have joined Sunnyridge", not "you have
-- joined Carrigan Agricultural Co Pty Ltd". Falls back to the entity for a farm
-- that has not been split yet, and to empty for one that has never been named.
--
-- Replaced whole because that is the only way Postgres lets a function body
-- change. Everything else about it — the token, expiry and email checks, the
-- jsonb return type that avoids the ON CONFLICT ambiguity — is unchanged.
-- ---------------------------------------------------------------------------

create or replace function accept_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  inv        invitations%rowtype;
  v_user     uuid := auth.uid();
  v_email    text;
begin
  if v_user is null then
    raise exception 'You need to be signed in to accept an invitation.';
  end if;

  select * into inv from invitations
   where token = p_token and deleted_at is null
   limit 1;

  if not found then
    raise exception 'That invitation link is not valid.';
  end if;

  if inv.accepted_at is not null then
    raise exception 'That invitation has already been used.';
  end if;

  if inv.expires_at < now() then
    raise exception 'That invitation expired on %.', to_char(inv.expires_at, 'DD Mon YYYY');
  end if;

  select u.email into v_email from auth.users u where u.id = v_user;

  if lower(coalesce(v_email, '')) <> lower(inv.email) then
    raise exception 'That invitation was sent to %. You are signed in as %.',
      inv.email, coalesce(v_email, 'nobody');
  end if;

  insert into farm_users (id, farm_id, user_id, role, can_write_production, created_by, updated_by)
  values (gen_random_uuid(), inv.farm_id, v_user, inv.role, inv.can_write_production, v_user, v_user)
  on conflict (farm_id, user_id) do update
     set role                 = excluded.role,
         can_write_production = excluded.can_write_production,
         deleted_at           = null,
         updated_at           = now(),
         updated_by           = v_user;

  update invitations
     set accepted_at = now(), updated_at = now()
   where id = inv.id;

  return (
    select jsonb_build_object(
      'farm_id',   inv.farm_id,
      'role',      inv.role,
      'farm_name', coalesce(f.farm_name, f.entity_name, '')
    )
    from farms f where f.id = inv.farm_id
  );
end;
$$;

revoke all on function accept_invitation(text) from public;
grant execute on function accept_invitation(text) to authenticated;

notify pgrst, 'reload schema';
