-- Build 313: a trial owner starts their own farm.
--
-- The owner of a trial farm taps "Start my own farm" in Settings. The app clears the sample and gives them a blank season; this records
-- that they did it (so the support login can see who has moved on) and, unless they choose to keep it, ends the support login's access.

alter table trial_invites add column if not exists started_at timestamptz;

-- The owner's Settings asks: is this a trial farm, and has the owner already started their own?
create or replace function trial_farm_status(p_farm_id uuid)
returns table (trial boolean, started_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select true, t.started_at
    from trial_invites t
   where t.farm_id = p_farm_id and app_role(p_farm_id) = 'owner'
   limit 1
$$;
revoke all on function trial_farm_status(uuid) from public;
grant execute on function trial_farm_status(uuid) to authenticated;

-- The owner has started their own farm. Support keeps its read-only view only if the owner says so.
create or replace function trial_start_own(p_farm_id uuid, p_keep_support boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or app_role(p_farm_id) is distinct from 'owner' then
    raise exception 'only the owner can do that';
  end if;
  if not exists (select 1 from trial_invites where farm_id = p_farm_id) then
    raise exception 'this is not a trial farm';
  end if;
  update trial_invites set started_at = coalesce(started_at, now()) where farm_id = p_farm_id;
  if not coalesce(p_keep_support, false) then
    update farm_users set deleted_at = now()
     where farm_id = p_farm_id and role = 'support' and deleted_at is null;
    insert into support_access_log (farm_id, action) values (p_farm_id, 'revoked');
  end if;
end;
$$;
revoke all on function trial_start_own(uuid, boolean) from public;
grant execute on function trial_start_own(uuid, boolean) to authenticated;

-- The two lists the support login reads now say who has started their own. A returned table cannot change shape in place, so they are
-- dropped and made again.
drop function if exists trial_invites_list();
create function trial_invites_list()
returns table (id uuid, email text, note text, created_at timestamptz, used_at timestamptz, farm_id uuid, farm_name text, started_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.email, t.note, t.created_at, t.used_at, t.farm_id,
         coalesce(nullif(f.farm_name, ''), f.entity_name), t.started_at
    from trial_invites t
    left join farms f on f.id = t.farm_id
   where is_support_admin() and t.withdrawn_at is null
   order by t.created_at desc
$$;
revoke all on function trial_invites_list() from public;
grant execute on function trial_invites_list() to authenticated;

drop function if exists support_farms();
create function support_farms()
returns table (farm_id uuid, farm_name text, role text, trial boolean, owner_email text, created_at timestamptz, started_at timestamptz)
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
         f.created_at,
         (select t.started_at from trial_invites t where t.farm_id = fu.farm_id limit 1)
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

notify pgrst, 'reload schema';
