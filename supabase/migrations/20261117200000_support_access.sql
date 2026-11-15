-- Support tools. Safe to run more than once.
--
-- 1. Support access: the owner can give the person who looks after the app a read-only view of the farm for
--    7 days. It switches itself off: the membership carries an expiry, and app_role() (which every policy asks)
--    stops seeing it once the time has passed. Granting, taking away and every time support opens the farm are
--    written to a log the owner can read.
--
-- 2. Report a problem: a member sends a short message with what the app knows (build, role, sync state, recent
--    errors). Read in the Supabase table editor.
--
-- Support is one person's login, named once by whoever runs this (see the last statement at the foot of this file).

-- ---------------------------------------------------------------------------
-- 1. Support access
-- ---------------------------------------------------------------------------

alter table farm_users
  add column if not exists expires_at timestamptz;

-- a role of 'support' is allowed on a membership (an invitation is never for support)
alter table farm_users drop constraint if exists farm_users_role_check;
alter table farm_users add constraint farm_users_role_check
  check (role in ('owner', 'manager', 'bookkeeper', 'farm_worker', 'driver', 'support'));

-- every policy resolves through this: a membership past its expiry is no membership
create or replace function app_role(p_farm uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
    from farm_users
   where farm_id = p_farm
     and user_id = auth.uid()
     and deleted_at is null
     and (expires_at is null or expires_at > now())
   limit 1
$$;

-- who the support person is: one login, set once. No client can read or write this table.
create table if not exists support_settings (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table support_settings enable row level security;

-- what happened, for the owner to read
create table if not exists support_access_log (
  id          uuid primary key default gen_random_uuid(),
  farm_id     uuid not null references farms(id) on delete cascade,
  action      text not null check (action in ('granted', 'revoked', 'opened')),
  by_user     uuid default auth.uid(),
  expires_at  timestamptz,
  at          timestamptz not null default now()
);
create index if not exists support_access_log_farm_idx on support_access_log (farm_id, at desc);
alter table support_access_log enable row level security;

drop policy if exists support_access_log_select on support_access_log;
create policy support_access_log_select on support_access_log for select
  using (app_role(farm_id) = 'owner');

grant select on support_access_log to authenticated;

-- The owner gives support a read-only view for a number of days (7 by default, never more than 14).
create or replace function grant_support_access(p_farm_id uuid, p_days int default 7)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_support uuid;
  v_until timestamptz;
begin
  if auth.uid() is null or app_role(p_farm_id) is distinct from 'owner' then
    raise exception 'only the owner can give support access';
  end if;
  select user_id into v_support from support_settings limit 1;
  if v_support is null then
    raise exception 'support access has not been set up yet';
  end if;
  if v_support = auth.uid() then
    raise exception 'that is your own login';
  end if;
  v_until := now() + make_interval(days => greatest(1, least(coalesce(p_days, 7), 14)));

  insert into farm_users (id, farm_id, user_id, role, can_write_production, expires_at, created_by)
  values (gen_random_uuid(), p_farm_id, v_support, 'support', false, v_until, auth.uid())
  on conflict (farm_id, user_id) do update
    set role = 'support', expires_at = v_until, deleted_at = null, can_write_production = false;

  insert into support_access_log (farm_id, action, expires_at) values (p_farm_id, 'granted', v_until);
  return v_until;
end;
$$;

revoke all on function grant_support_access(uuid, int) from public;
grant execute on function grant_support_access(uuid, int) to authenticated;

-- The owner takes it away early.
create or replace function revoke_support_access(p_farm_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or app_role(p_farm_id) is distinct from 'owner' then
    raise exception 'only the owner can take support access away';
  end if;
  update farm_users set deleted_at = now()
   where farm_id = p_farm_id and role = 'support' and deleted_at is null;
  insert into support_access_log (farm_id, action) values (p_farm_id, 'revoked');
end;
$$;

revoke all on function revoke_support_access(uuid) from public;
grant execute on function revoke_support_access(uuid) to authenticated;

-- Until when support can look, or nothing when it cannot. The owner's Settings asks this.
create or replace function support_access_until(p_farm_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select max(expires_at)
    from farm_users
   where farm_id = p_farm_id and role = 'support' and deleted_at is null and expires_at > now()
     and app_role(p_farm_id) = 'owner'
$$;

revoke all on function support_access_until(uuid) from public;
grant execute on function support_access_until(uuid) to authenticated;

-- Support opening the farm is written down.
create or replace function log_support_open(p_farm_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if app_role(p_farm_id) = 'support' then
    insert into support_access_log (farm_id, action, expires_at)
    select p_farm_id, 'opened', fu.expires_at
      from farm_users fu
     where fu.farm_id = p_farm_id and fu.user_id = auth.uid() and fu.deleted_at is null;
  end if;
end;
$$;

revoke all on function log_support_open(uuid) from public;
grant execute on function log_support_open(uuid) to authenticated;

-- the people list does not show an expired support login
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
     and (fu.expires_at is null or fu.expires_at > now())
     and app_role(p_farm) in ('owner', 'manager')
   order by fu.created_at;
$$;

-- Support can read what the farm holds, and write nothing: a read policy on each table, no insert or update policy.
-- The bank details are not on the list.
do $$
declare
  t text;
  has_deleted boolean;
begin
  foreach t in array array[
    'seasons', 'commodities', 'fields', 'field_agronomy', 'storages', 'sales', 'sale_terms', 'sale_documents',
    'movements', 'movement_legs', 'movement_photos', 'invoices', 'overheads', 'payables', 'orders',
    'freight_orders', 'input_stock', 'spray_jobs', 'record_documents'
  ] loop
    if to_regclass('public.' || t) is not null then
      select exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = t and column_name = 'deleted_at'
      ) into has_deleted;
      execute format('drop policy if exists %I on %I', 'support_read_' || t, t);
      execute format('create policy %I on %I for select using (app_role(farm_id) = ''support''%s)',
                     'support_read_' || t, t, case when has_deleted then ' and deleted_at is null' else '' end);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Report a problem
-- ---------------------------------------------------------------------------

create table if not exists problem_reports (
  id         uuid primary key default gen_random_uuid(),
  farm_id    uuid references farms(id) on delete cascade,
  user_id    uuid default auth.uid(),
  role       text,
  build      text,
  message    text,
  details    jsonb,
  created_at timestamptz not null default now()
);
alter table problem_reports enable row level security;

drop policy if exists problem_reports_insert on problem_reports;
create policy problem_reports_insert on problem_reports for insert
  with check (user_id = auth.uid() and (farm_id is null or app_is_member(farm_id)));

grant insert on problem_reports to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- ONE LAST STEP, done once by whoever runs the app's support. It is not part of this file because it names a
-- person. Run this on its own, with the email you sign in to Grainflow with:
--
--   insert into support_settings (user_id) select id from auth.users where email = 'you@example.com'
--   on conflict do nothing;
-- ---------------------------------------------------------------------------
