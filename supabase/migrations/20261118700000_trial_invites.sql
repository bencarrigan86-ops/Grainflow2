-- Build 311: trial invites.
--
-- Whoever looks after Commodity Mate (the login named in support_settings) can invite somebody by email to try it. When that person
-- signs up and creates their farm, the farm is theirs alone (nobody else invited can see it) and the support login is added to it
-- with a standing, read-only membership, so every trial farm can be opened from the one login. The owner of the trial farm is told
-- this on the screen, and can switch it off at any time (revoke_support_access, the same button as ever).

create table if not exists trial_invites (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  note         text,
  created_by   uuid not null default auth.uid(),
  created_at   timestamptz not null default now(),
  farm_id      uuid references farms(id) on delete set null,
  used_at      timestamptz,
  withdrawn_at timestamptz
);
-- one open invitation per address
create unique index if not exists trial_invites_open_email on trial_invites (email)
  where used_at is null and withdrawn_at is null;
-- no policies and no grants: this table is only reached through the functions below
alter table trial_invites enable row level security;

-- Is the signed-in person the support login?
create or replace function is_support_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from support_settings where user_id = auth.uid())
$$;
revoke all on function is_support_admin() from public;
grant execute on function is_support_admin() to authenticated;

create or replace function trial_invite_create(p_email text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid;
begin
  if not is_support_admin() then
    raise exception 'only the support login can invite a trial';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'that does not look like an email address';
  end if;
  if exists (select 1 from trial_invites where email = v_email and used_at is null and withdrawn_at is null) then
    raise exception 'that address already has an open trial invitation';
  end if;
  insert into trial_invites (email, note) values (v_email, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function trial_invite_create(text, text) from public;
grant execute on function trial_invite_create(text, text) to authenticated;

create or replace function trial_invite_withdraw(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_support_admin() then
    raise exception 'only the support login can withdraw a trial invitation';
  end if;
  update trial_invites set withdrawn_at = now()
   where id = p_id and used_at is null and withdrawn_at is null;
end;
$$;
revoke all on function trial_invite_withdraw(uuid) from public;
grant execute on function trial_invite_withdraw(uuid) to authenticated;

-- The invitations still open, and the ones used, newest first.
create or replace function trial_invites_list()
returns table (id uuid, email text, note text, created_at timestamptz, used_at timestamptz, farm_id uuid, farm_name text)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.email, t.note, t.created_at, t.used_at, t.farm_id,
         coalesce(nullif(f.farm_name, ''), f.entity_name)
    from trial_invites t
    left join farms f on f.id = t.farm_id
   where is_support_admin() and t.withdrawn_at is null
   order by t.created_at desc
$$;
revoke all on function trial_invites_list() from public;
grant execute on function trial_invites_list() to authenticated;

-- Every farm the support login can open: its own, and the trial farms. The owner's email only where it is somebody else's farm.
create or replace function support_farms()
returns table (farm_id uuid, farm_name text, role text, trial boolean, owner_email text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select fu.farm_id,
         coalesce(nullif(f.farm_name, ''), f.entity_name),
         fu.role,
         exists (select 1 from trial_invites t where t.farm_id = fu.farm_id),
         case when fu.role = 'support'
              then (select u.email::text from farm_users o join auth.users u on u.id = o.user_id
                     where o.farm_id = fu.farm_id and o.role = 'owner' and o.deleted_at is null limit 1)
         end,
         f.created_at
    from farm_users fu
    join farms f on f.id = fu.farm_id and f.deleted_at is null
   where is_support_admin()
     and fu.user_id = auth.uid()
     and fu.deleted_at is null
     and (fu.expires_at is null or fu.expires_at > now())
   order by (fu.role = 'support'), f.created_at desc
$$;
revoke all on function support_farms() from public;
grant execute on function support_farms() to authenticated;

-- Is there an open trial invitation for the signed-in person's own address? The "name your farm" screen asks, to be honest with them.
create or replace function my_trial_invite()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from trial_invites t join auth.users u on lower(u.email) = t.email
     where u.id = auth.uid() and t.used_at is null and t.withdrawn_at is null)
$$;
revoke all on function my_trial_invite() from public;
grant execute on function my_trial_invite() to authenticated;

-- Has support been given standing access to this farm as part of a trial? The owner's Settings says so.
create or replace function support_standing(p_farm_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app_role(p_farm_id) = 'owner'
     and exists (select 1 from farm_users
                  where farm_id = p_farm_id and role = 'support' and deleted_at is null and expires_at is null)
$$;
revoke all on function support_standing(uuid) from public;
grant execute on function support_standing(uuid) to authenticated;

-- Creating a farm: the same as ever, and when the new owner has an open trial invitation, the support login is added, read only, with
-- no end date, and the invitation is marked used.
create or replace function create_farm(p_farm_id uuid, p_entity_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_invite uuid;
  v_support uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into farms (id, entity_name, created_by, updated_by, trial_ends_at)
  values (p_farm_id, p_entity_name, auth.uid(), auth.uid(), now() + interval '1 year');

  insert into farm_users (id, farm_id, user_id, role, can_write_production, created_by, updated_by)
  values (gen_random_uuid(), p_farm_id, auth.uid(), 'owner', true, auth.uid(), auth.uid());

  select lower(email) into v_email from auth.users where id = auth.uid();
  select id into v_invite from trial_invites
   where email = v_email and used_at is null and withdrawn_at is null limit 1;
  select user_id into v_support from support_settings limit 1;
  if v_invite is not null and v_support is not null and v_support <> auth.uid() then
    insert into farm_users (id, farm_id, user_id, role, can_write_production, expires_at, created_by, updated_by)
    values (gen_random_uuid(), p_farm_id, v_support, 'support', false, null, auth.uid(), auth.uid());
    update trial_invites set used_at = now(), farm_id = p_farm_id where id = v_invite;
  end if;

  return p_farm_id;
end;
$$;

notify pgrst, 'reload schema';
