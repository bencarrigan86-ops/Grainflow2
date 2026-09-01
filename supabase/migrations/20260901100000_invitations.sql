-- Joining a farm without the owner sharing a password.
--
-- The invitations table has existed since the first migration and nothing has
-- ever written to it: the plumbing was laid and the tap never fitted. Adding
-- someone to a farm has meant an INSERT typed by hand, which is not a thing to
-- ask of anyone and not a thing to do at speed — the last one went to the wrong
-- farm because the statement picked it by paddock count.
--
-- Two functions, both security definer, because both have to do something the
-- caller is deliberately not allowed to do directly.

-- ---------------------------------------------------------------------------
-- Accepting an invitation
--
-- The invitee has no membership row yet, so every policy on farm_users refuses
-- them — including the insert that would create it. That is correct: an insert
-- policy loose enough to let a stranger add themselves is an insert policy that
-- lets a stranger add themselves. So the insert happens here, as definer, only
-- after the token, the expiry and the email have all been checked.
--
-- The email match is the part that matters. Without it a link forwarded to the
-- wrong person, or found in a screenshot, admits whoever opens it. With it, the
-- link is only useful to the address it was issued to.
-- ---------------------------------------------------------------------------

-- Returns jsonb rather than a table, deliberately. `returns table (farm_id …,
-- role …)` declares PL/pgSQL variables with those names, and the insert below
-- then fails with "column reference farm_id is ambiguous" on its ON CONFLICT
-- clause — caught by running this against a real Postgres rather than reading
-- it. One object out, no variables to collide with the columns.
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

  -- on conflict, because someone re-invited to change a role should end up with
  -- the new role rather than an error. Also un-deletes a membership that was
  -- previously removed, which is what re-inviting a returning seasonal worker
  -- is meant to do.
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
      'farm_name', coalesce(f.entity_name, '')
    )
    from farms f where f.id = inv.farm_id
  );
end;
$$;

revoke all on function accept_invitation(text) from public;
grant execute on function accept_invitation(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Who is on this farm
--
-- farm_users is readable by any member, but it holds user ids, not names. The
-- address is in auth.users, which no client may read — correctly, since it is
-- every user of the platform, not just this farm's.
--
-- So: definer, joined, and scoped twice. Once to the farm asked for, and once
-- by app_role(), which still sees the *caller's* role inside a definer function
-- because auth.uid() is unchanged. A driver calling this gets nothing.
-- ---------------------------------------------------------------------------

create or replace function farm_members(p_farm uuid)
returns table (
  user_id              uuid,
  email                text,
  role                 text,
  can_write_production boolean,
  joined_at            timestamptz
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select fu.user_id, u.email::text, fu.role, fu.can_write_production, fu.created_at
    from farm_users fu
    join auth.users u on u.id = fu.user_id
   where fu.farm_id = p_farm
     and fu.deleted_at is null
     and app_role(p_farm) in ('owner', 'manager')
   order by fu.created_at;
$$;

revoke all on function farm_members(uuid) from public;
grant execute on function farm_members(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Pending invitations, for the same screen
--
-- Same shape, same reason: an owner needs to see what is outstanding so they
-- can chase or revoke it. Restricted to owners, matching the insert policy —
-- there is no point showing a list to someone who cannot act on it.
-- ---------------------------------------------------------------------------

create or replace function pending_invitations(p_farm uuid)
returns table (
  id         uuid,
  email      text,
  role       text,
  can_write_production boolean,
  token      text,
  expires_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.email, i.role, i.can_write_production, i.token, i.expires_at, i.created_at
    from invitations i
   where i.farm_id = p_farm
     and i.deleted_at is null
     and i.accepted_at is null
     and app_role(p_farm) = 'owner'
   order by i.created_at desc;
$$;

revoke all on function pending_invitations(uuid) from public;
grant execute on function pending_invitations(uuid) to authenticated;

-- An owner already has insert and update policies on invitations, so creating
-- and revoking one needs no function of its own — the client writes the row.
