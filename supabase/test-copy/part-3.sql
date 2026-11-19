-- Test database, part 3 of 4: 20261117100000_bank_and_worker_inputs.sql to 20261209000000_farm_switches.sql.
-- Paste ALL of this into the Supabase SQL editor of the TEST project and press Run. Run the parts in order.

-- ---------------------------------------------------------------------------
-- 20261117100000_bank_and_worker_inputs.sql
-- ---------------------------------------------------------------------------
-- Two security fixes. Safe to run more than once.
--
-- 1. Bank details. They sat in the farms row, and every member of a farm can read that row, so a driver's phone held the
--    farm's account number. They now live in farm_bank, which only the owner and the bookkeeper can read, and only the
--    owner can write. The old columns stay (an older copy of the app still names them) but are emptied, and a trigger
--    moves anything an older copy writes there into farm_bank.
--
-- 2. Inputs and stock for farm workers. A worker can now see what is on hand and record what is used and counts, with
--    no prices. input_stock still holds the prices, so a worker reads it only through a function that blanks them, and
--    can write only 'use' and 'adjust' entries, which carry no price.

-- ---------------------------------------------------------------------------
-- 1. farm_bank
-- ---------------------------------------------------------------------------

create table if not exists farm_bank (
  farm_id        uuid primary key references farms(id) on delete cascade,
  bank_name      text,
  account_name   text,
  bsb            text,
  account_number text,
  updated_at     timestamptz not null default now(),
  updated_by     uuid default auth.uid()
);

alter table farm_bank enable row level security;

drop policy if exists farm_bank_select on farm_bank;
create policy farm_bank_select on farm_bank for select
  using (app_role(farm_id) in ('owner', 'bookkeeper'));

drop policy if exists farm_bank_insert on farm_bank;
create policy farm_bank_insert on farm_bank for insert
  with check (app_role(farm_id) = 'owner');

drop policy if exists farm_bank_update on farm_bank;
create policy farm_bank_update on farm_bank for update
  using (app_role(farm_id) = 'owner')
  with check (app_role(farm_id) = 'owner');

grant select, insert, update on farm_bank to authenticated;

drop trigger if exists farm_bank_set_updated_at on farm_bank;
create trigger farm_bank_set_updated_at before update on farm_bank
  for each row execute function set_updated_at();

-- what is already there moves across
insert into farm_bank (farm_id, bank_name, account_name, bsb, account_number)
select id, bank_name, account_name, bsb, account_number
  from farms
 where bank_name is not null or account_name is not null or bsb is not null or account_number is not null
on conflict (farm_id) do nothing;

-- an older copy of the app still writes the bank details to the farms row: keep them out of it
create or replace function farms_move_bank()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.bank_name is not null or new.account_name is not null or new.bsb is not null or new.account_number is not null then
    insert into farm_bank (farm_id, bank_name, account_name, bsb, account_number)
    values (new.id, new.bank_name, new.account_name, new.bsb, new.account_number)
    on conflict (farm_id) do update
      set bank_name = excluded.bank_name, account_name = excluded.account_name,
          bsb = excluded.bsb, account_number = excluded.account_number;
  end if;
  new.bank_name := null;
  new.account_name := null;
  new.bsb := null;
  new.account_number := null;
  return new;
end;
$$;

drop trigger if exists farms_move_bank_trg on farms;
create trigger farms_move_bank_trg before insert or update on farms
  for each row execute function farms_move_bank();

-- empty the old columns (the trigger above does it for every row it touches; this touches them all once)
update farms set bank_name = bank_name
 where bank_name is not null or account_name is not null or bsb is not null or account_number is not null;

-- ---------------------------------------------------------------------------
-- 2. Inputs and stock for farm workers
-- ---------------------------------------------------------------------------

-- A worker sees the entries that carry no price (use and count). Every entry, with the prices blanked, is read
-- through input_stock_for_worker() below.
drop policy if exists input_stock_select on input_stock;
create policy input_stock_select on input_stock for select
  using ((app_role(farm_id) in ('owner', 'manager', 'bookkeeper')
          or (app_role(farm_id) = 'farm_worker' and move_type in ('use', 'adjust')))
         and deleted_at is null);

drop policy if exists input_stock_insert on input_stock;
create policy input_stock_insert on input_stock for insert
  with check (app_role(farm_id) in ('owner', 'manager', 'bookkeeper')
              or (app_role(farm_id) = 'farm_worker' and move_type in ('use', 'adjust') and unit_cost is null));

drop policy if exists input_stock_update on input_stock;
create policy input_stock_update on input_stock for update
  using (app_role(farm_id) in ('owner', 'manager', 'bookkeeper')
         or (app_role(farm_id) = 'farm_worker' and move_type in ('use', 'adjust')))
  with check (app_role(farm_id) in ('owner', 'manager', 'bookkeeper')
              or (app_role(farm_id) = 'farm_worker' and move_type in ('use', 'adjust') and unit_cost is null));

-- Every entry on the farm with the prices, the supplier and the invoice number left out. Only a farm worker gets
-- rows: everyone else reads the table itself.
create or replace function input_stock_for_worker(p_farm_id uuid)
returns table (
  id uuid, farm_id uuid, season_id uuid, kind text, product text, unit text, move_type text, qty numeric,
  unit_cost numeric, move_date date, supplier text, reference text, notes text, location text,
  created_at timestamptz, updated_at timestamptz, created_by uuid, updated_by uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.farm_id, s.season_id, s.kind, s.product, s.unit, s.move_type, s.qty,
         null::numeric, s.move_date, null::text, null::text, s.notes, s.location,
         s.created_at, s.updated_at, s.created_by, s.updated_by
    from input_stock s
   where s.farm_id = p_farm_id
     and s.deleted_at is null
     and app_role(p_farm_id) = 'farm_worker'
$$;

revoke all on function input_stock_for_worker(uuid) from public;
grant execute on function input_stock_for_worker(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 20261117200000_support_access.sql
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 20261118100000_yield_recorded.sql
-- ---------------------------------------------------------------------------
-- A past season imported from the farm's own records has yields that are neither an estimate nor tonnes carted on
-- tickets in the app: they were recorded at the time. Allow a third yield mode, 'recorded', so the rotation history can
-- show those yields as they were and not tag them as estimates. The app works out tonnes from it exactly as it does for
-- an estimate (area x yield), so nothing else about a paddock changes.

do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.field_agronomy'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%yield_mode%'
  loop
    execute format('alter table public.field_agronomy drop constraint %I', c);
  end loop;
end $$;

alter table field_agronomy add constraint field_agronomy_yield_mode_check check (yield_mode in ('estimate', 'actual', 'recorded'));

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261118200000_revoke_invitation.sql
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 20261118300000_season_delete_owner_only.sql
-- ---------------------------------------------------------------------------
-- Deleting a season: the owner only.
--
-- soft_delete_row() lets an owner or manager remove anyone's record, and anyone else what they created. A whole season is
-- different: it takes every paddock, contract, load and invoice in it, and Recently deleted cannot bring it back. The app
-- now offers the button to the owner only; this makes the server say the same, so no other role (or older copy of the
-- app) can stamp a season as deleted.
--
-- Same function as 20261115100000_spray_jobs.sql with one added rule. Idempotent: safe to run again.

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
    'sale_terms', 'sale_documents', 'record_documents', 'movements', 'movement_legs',
    'movement_photos', 'invoices', 'overheads', 'payables', 'orders', 'freight_orders', 'input_stock', 'spray_jobs'
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

  -- a whole season goes only at the owner's hand, whoever created it
  if p_table = 'seasons' and app_role(v_farm) is distinct from 'owner' then
    raise exception 'only the owner can delete a season';
  end if;

  if not (
    app_role(v_farm) in ('owner', 'manager')
    or v_created = auth.uid()
    or (p_table in ('sale_documents', 'record_documents') and app_role(v_farm) = 'bookkeeper')
  ) then
    raise exception 'not allowed';
  end if;

  execute format('update %I set deleted_at = now() where id = $1 and deleted_at is null', p_table) using p_id;
end;
$$;

revoke all on function soft_delete_row(text, uuid) from public;
grant execute on function soft_delete_row(text, uuid) to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261118400000_ffa_pct.sql
-- ---------------------------------------------------------------------------
-- Canola free fatty acid (FFA): the FFA % of a load or a silo, beside the oil %.
-- Optional: stored only once an FFA figure has been recorded, so a farm without the column can still save loads.
alter table movements
  add column if not exists ffa_pct numeric(6,2);
alter table storages
  add column if not exists ffa_pct numeric(6,2);

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261118500000_commodity_order.sql
-- ---------------------------------------------------------------------------
-- The order the commodities are listed in on every screen: their names, in the order the owner set (optional; stored only once
-- a list has been set). Safe to run more than once.
alter table farms
  add column if not exists commodity_order jsonb;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261118600000_outload_numbers.sql
-- ---------------------------------------------------------------------------
-- Outload numbers: the number a truck is given to quote at a third-party site (the site keeps it on its ticket, and the delivery
-- data comes back against it). Safe to run more than once.
--
-- A number is the season (two digits), the person's series digit and that person's own count: 26 1 001 is 261001. Each person on
-- the farm has a series digit of their own (1 to 9), so two phones that are both out of signal can never give out the same number.
--
-- 1. each member's series digit, unique among the members still on the farm, handed out automatically
-- 2. the number on the load (optional column)
-- 3. the farm's saved import formats (optional column)

alter table farm_users
  add column if not exists outload_series smallint;

alter table farm_users
  drop constraint if exists farm_users_outload_series_range;
alter table farm_users
  add constraint farm_users_outload_series_range check (outload_series is null or outload_series between 1 and 9);

-- one digit, one person: while somebody is on the farm their digit is theirs alone
create unique index if not exists farm_users_outload_series_unique
  on farm_users (farm_id, outload_series)
  where outload_series is not null and deleted_at is null;

-- the lowest digit nobody on the farm is using, for people who write loads (not the bookkeeper or support)
create or replace function assign_outload_series()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_digit smallint;
begin
  if new.deleted_at is not null or new.role not in ('owner', 'manager', 'farm_worker', 'driver') then
    return new;
  end if;
  -- keep a digit that is still free (a person brought back onto the farm keeps theirs unless somebody has taken it since)
  if new.outload_series is not null
     and not exists (
       select 1 from farm_users f
       where f.farm_id = new.farm_id and f.outload_series = new.outload_series
         and f.deleted_at is null and f.id <> new.id
     ) then
    return new;
  end if;
  select d into v_digit
  from generate_series(1, 9) as d
  where not exists (
    select 1 from farm_users f
    where f.farm_id = new.farm_id and f.outload_series = d and f.deleted_at is null and f.id <> new.id
  )
  order by d
  limit 1;
  new.outload_series := v_digit;   -- null when all nine are taken: the owner is told, and can free one
  return new;
end;
$$;

drop trigger if exists farm_users_assign_outload_series on farm_users;
create trigger farm_users_assign_outload_series
  before insert or update of deleted_at, role on farm_users
  for each row execute function assign_outload_series();

-- the people already on the farms, the oldest first (the owner first of all)
do $$
declare
  r record;
begin
  for r in
    select id from farm_users
    where outload_series is null and deleted_at is null and role in ('owner', 'manager', 'farm_worker', 'driver')
    order by farm_id, (role = 'owner') desc, created_at, id
  loop
    update farm_users set role = role where id = r.id;   -- fires the trigger, which picks the digit
  end loop;
end;
$$;

-- the number a truck quotes, on the load
alter table movements
  add column if not exists outload_no text;

create index if not exists movements_outload_no_idx on movements (farm_id, outload_no) where outload_no is not null;

-- the farm's saved layouts for the files that come back from a site (which column is the weight, which is moisture, ...)
alter table farms
  add column if not exists import_formats jsonb;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261118700000_trial_invites.sql
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 20261118800000_trial_start_own.sql
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 20261118900000_storage_volume.sql
-- ---------------------------------------------------------------------------
-- Build 317: a storage can be given a volume in cubic metres. The most it holds is that volume times the test weight of what is in
-- it (the commodity's, or the one set on the storage), worked out in the app. Blank means the tonnes typed on it are used, as before.
alter table storages
  add column if not exists volume_m3 numeric(12,2);
alter table storages
  drop constraint if exists storages_volume_check;
alter table storages
  add constraint storages_volume_check check (volume_m3 is null or volume_m3 >= 0);

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261118950000_harvest_season.sql
-- ---------------------------------------------------------------------------
-- Build 318: which part of the year a commodity is harvested in (winter or summer), so harvest progress can be read for each. Blank means
-- automatic: the app goes by the commodity's name.
alter table commodities
  add column if not exists harvest_season text;
alter table commodities
  drop constraint if exists commodities_harvest_season_check;
alter table commodities
  add constraint commodities_harvest_season_check check (harvest_season is null or harvest_season in ('winter', 'summer'));

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261118970000_harvest_left_yield.sql
-- ---------------------------------------------------------------------------
-- Build 320: the yield expected from the hectares still to harvest on a part-harvested paddock, when it differs from the paddock's own
-- yield estimate. Blank means the paddock's estimate. Optional and idempotent.

alter table fields
  add column if not exists harvest_left_yield numeric;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261119000000_farm_logo.sql
-- ---------------------------------------------------------------------------
-- The farm's logo: a small JPEG kept as text (a data address), printed in the header of the PDFs.
-- Optional; stored only once a logo has been added. Safe to run more than once.
alter table farms
  add column if not exists logo text;

-- The people who sign for the business: their names, one to a line, offered as the printed name on documents.
alter table farms
  add column if not exists signers text;

-- Whether the logo is switched off (it is printed whenever there is one, unless this is true).
alter table farms
  add column if not exists logo_off boolean;

-- ---------------------------------------------------------------------------
-- 20261120000000_sale_invoicing.sql
-- ---------------------------------------------------------------------------
-- Who invoices on a contract: 'seller' (the farm invoices the buyer) or 'rcti' (the buyer issues a recipient created tax invoice).
-- Optional; stored only once it has been set. Safe to run more than once.
alter table sales
  add column if not exists invoicing text;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261121000000_freight_address_parts.sql
-- ---------------------------------------------------------------------------
-- A freight order's Deliver from and Deliver to addresses, kept in parts (line 1, line 2, town, state, postcode) beside the
-- one line each already has. Optional; stored only once an address has been entered in parts. Safe to run more than once.
alter table freight_orders
  add column if not exists pickup_parts jsonb;
alter table freight_orders
  add column if not exists deliver_to_parts jsonb;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261122000000_freight_buyer_order_no.sql
-- ---------------------------------------------------------------------------
-- The buyer's order number, typed on a freight order (for a job with no grain order, or to override the grain order's).
-- Optional; stored only once one has been entered. Safe to run more than once.
alter table freight_orders
  add column if not exists buyer_order_no text;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261123000000_storage_fumigations.sql
-- ---------------------------------------------------------------------------
-- Fumigations of a silo, bunker or shed: a record, newest first when shown.
--
--   [ { "id": "f2026-11-10-ab12c", "date": "2026-11-10", "product": "Phosphine", "days": 14,
--       "endsOn": "2026-11-24", "notes": "" }, ... ]
--
-- "endsOn" is the first day the grain is clear to load out (the date plus the withholding days, or typed over).
-- Optional: nothing is stored unless a fumigation is recorded. Safe to run more than once.
alter table storages
  add column if not exists fumigations jsonb;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261124000000_movement_manual_docket.sql
-- ---------------------------------------------------------------------------
-- Our own manual (paper) docket number on a load, typed on the ticket.
-- Optional; stored only once one has been entered. Safe to run more than once.
alter table movements
  add column if not exists manual_docket_no text;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261125000000_sale_document_confirmation.sql
-- ---------------------------------------------------------------------------
-- A sent confirmation of sale is filed with its contract, like a sent vendor declaration or freight order.
-- Safe to run more than once.
alter table sale_documents
  drop constraint if exists sale_documents_kind_check;
alter table sale_documents
  add constraint sale_documents_kind_check
  check (kind in ('contract', 'broker_note', 'vendor_dec', 'freight_order', 'confirmation', 'other'));

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261126000000_movement_deductions.sql
-- ---------------------------------------------------------------------------
-- A load can carry deductions for faults the contract does not price: [{ "reason": "Screenings 6% vs contract 5%", "perTon": 10 }].
-- Safe to run more than once.
alter table movements add column if not exists deductions jsonb;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261127000000_movement_gin.sql
-- ---------------------------------------------------------------------------
-- A cotton ginning run is kept on its movement: modules, bales, lint and seed weights, the gin's rates and levies.
-- Safe to run more than once.
alter table movements add column if not exists gin jsonb;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261128000000_commodity_cotton.sql
-- ---------------------------------------------------------------------------
-- Cotton is valued as lint, seed and ginning. These are the commodity's settings for the seed and the ginning:
-- the seed price ($/t), the seed per bale (t), and the ginning and levies ($/bale). Safe to run more than once.
alter table commodities add column if not exists cotton jsonb;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261129000000_movement_modules.sql
-- ---------------------------------------------------------------------------
-- Cotton modules carted from a paddock to the gin yard: how many, their weight, the turnout and the bales that gives.
-- Safe to run more than once.
alter table movements add column if not exists modules jsonb;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261130000000_field_modules_picked.sql
-- ---------------------------------------------------------------------------
-- Cotton modules picked on a paddock: how many, their estimated weight, the turnout and the bales that gives.
-- Safe to run more than once.
alter table fields add column if not exists modules_picked jsonb;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261201000000_hay.sql
-- ---------------------------------------------------------------------------
-- Hay: the kind of bale and its average weight on the commodity, and the bales baled on a paddock.
-- Safe to run more than once.
alter table commodities add column if not exists hay jsonb;
alter table fields add column if not exists bales_baled jsonb;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261202000000_hay_loads.sql
-- ---------------------------------------------------------------------------
-- Hay: the bales on a load (bales and weight, and what it was used for when it was used on the farm).
-- Safe to run more than once.
alter table movements add column if not exists hay_load jsonb;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261203000000_payable_payer.sql
-- ---------------------------------------------------------------------------
-- Who settles a bill: blank means the farm; 'buyer' means the buyer of the lint pays the gin and takes it off the lint payment.
-- Safe to run more than once.
alter table payables add column if not exists payer text;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261204000000_cotton_contract_kinds.sql
-- ---------------------------------------------------------------------------
-- Cotton contracts with the gin: gin for seed, and ginning only. A lint sale and a seed sale outright need nothing new.
alter table sales add column if not exists cotton_kind text;
alter table sales add column if not exists cotton_terms jsonb;

-- ---------------------------------------------------------------------------
-- 20261205000000_order_detail.sql
-- ---------------------------------------------------------------------------
-- What the buyer puts on a grain order: issuer, grade, destination, address, reference, booking, site rules. One column, saved as a whole.
alter table orders add column if not exists detail jsonb;
-- and what the carrier's copy of a freight order carries: carrier ABN and contact, variety, packaging, payment terms, the two sites.
alter table freight_orders add column if not exists detail jsonb;

-- ---------------------------------------------------------------------------
-- 20261206000000_numbers_free_when_deleted.sql
-- ---------------------------------------------------------------------------
-- A deleted ticket or invoice no longer holds its number.
--
-- Deleting a record only stamps deleted_at: the row stays, and the plain unique constraints on (farm_id, ticket_no) and
-- (farm_id, invoice_no) kept the number of a deleted row for ever. A farm that is reset, or has a season imported or the sample
-- loaded over it, brings in new records that reuse the numbers of the old ones (ticket 1001, invoice 1). The server refused them
-- ("duplicate key value violates unique constraint movements_farm_id_ticket_no_key"), the phone stopped sending, and its changes
-- stayed waiting.
--
-- The numbers must still be unique among the records that are live, so the constraints become unique indexes over the rows
-- that are not deleted. (Restoring a deleted record that has lost its number already renumbers it: see recently_deleted.)

alter table movements drop constraint if exists movements_farm_id_ticket_no_key;
create unique index if not exists movements_farm_ticket_no_live on movements (farm_id, ticket_no) where deleted_at is null;

alter table invoices drop constraint if exists invoices_farm_id_invoice_no_key;
create unique index if not exists invoices_farm_invoice_no_live on invoices (farm_id, invoice_no) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 20261207000000_audit_log.sql
-- ---------------------------------------------------------------------------
-- Audit history: who changed what, and when.
--
-- The database writes it, not the app, so nothing the app does can skip it and nothing a person does can edit it. A row is written
-- when a contract, load, invoice, bill, order, commodity, paddock, silo or the like is added, changed, deleted or restored. A change
-- keeps the column, what it was and what it became. Owners, managers and bookkeepers can read it; nobody can write or delete it.
-- Safe to run more than once.

create table if not exists audit_log (
  id          bigint generated always as identity primary key,
  farm_id     uuid not null references farms(id) on delete cascade,
  at          timestamptz not null default now(),
  user_id     uuid,
  user_email  text,
  user_role   text,
  table_name  text not null,
  row_id      uuid,
  action      text not null check (action in ('added', 'changed', 'deleted', 'restored')),
  label       text,
  changes     jsonb
);

create index if not exists audit_log_farm_at_idx on audit_log (farm_id, at desc);

alter table audit_log enable row level security;

drop policy if exists audit_log_select on audit_log;
create policy audit_log_select on audit_log for select
  using (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'));

-- no insert, update or delete policy: only the trigger below writes to it
revoke all on audit_log from public;
grant select on audit_log to authenticated;

-- what to call the record in the list: a contract by its buyer and number, a load by its ticket, and so on
create or replace function audit_label(p_table text, r jsonb)
returns text
language sql
stable
set search_path = public
as $$
  select case p_table
    when 'sales' then concat_ws(' ', coalesce(nullif(r->>'buyer', ''), 'Contract'), '#' || nullif(r->>'contract_no', ''))
    when 'sale_terms' then (select concat_ws(' ', coalesce(nullif(s.buyer, ''), 'Contract'), '#' || nullif(s.contract_no, ''), 'price and terms')
                              from sales s where s.id = (r->>'sale_id')::uuid)
    when 'movements' then 'Ticket #' || coalesce(r->>'ticket_no', '?')
    when 'invoices' then 'Invoice #' || coalesce(r->>'invoice_no', '?')
    when 'payables' then coalesce(nullif(r->>'supplier', ''), nullif(r->>'kind', ''), 'Bill')
    when 'orders' then coalesce('Order #' || nullif(r->>'order_no', ''), 'Order')
    when 'freight_orders' then coalesce('Freight order ' || nullif(r->>'freight_no', ''), 'Freight order')
    when 'spray_jobs' then coalesce('Spray request ' || nullif(r->>'job_no', ''), 'Spray request')
    when 'overheads' then 'Overheads'
    else coalesce(nullif(r->>'name', ''), nullif(r->>'product', ''), nullif(r->>'title', ''))
  end
$$;

create or replace function audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n   jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  o   jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  act text;
  ch  jsonb := '{}'::jsonb;
  k   text;
  nv  jsonb;
  ov  jsonb;
  fid uuid;
begin
  fid := coalesce((n->>'farm_id')::uuid, (o->>'farm_id')::uuid);
  if fid is null then return null; end if;

  if tg_op = 'INSERT' then act := 'added';
  elsif tg_op = 'DELETE' then act := 'deleted';
  elsif o->>'deleted_at' is null and n->>'deleted_at' is not null then act := 'deleted';
  elsif o->>'deleted_at' is not null and n->>'deleted_at' is null then act := 'restored';
  else act := 'changed';
  end if;

  if tg_op = 'UPDATE' and act = 'changed' then
    for k in select jsonb_object_keys(n) loop
      continue when k in ('updated_at', 'updated_by', 'created_at', 'created_by', 'deleted_at');
      nv := n->k;
      ov := o->k;
      if nv is distinct from ov then
        -- a long value (a list of lines, a document body) is noted as edited rather than copied
        if length(coalesce(nv::text, '')) > 200 or length(coalesce(ov::text, '')) > 200 then
          ch := ch || jsonb_build_object(k, jsonb_build_array('...', '...'));
        else
          ch := ch || jsonb_build_object(k, jsonb_build_array(ov, nv));
        end if;
      end if;
    end loop;
    -- a save that changed nothing a person would care about (the sync sends rows again) is not an entry
    if ch = '{}'::jsonb then return null; end if;
  end if;

  insert into audit_log (farm_id, user_id, user_email, user_role, table_name, row_id, action, label, changes)
  values (fid, auth.uid(), auth.jwt() ->> 'email', app_role(fid), tg_table_name,
          coalesce((n->>'id')::uuid, (o->>'id')::uuid), act,
          audit_label(tg_table_name, coalesce(n, o)), nullif(ch, '{}'::jsonb));
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'sales', 'sale_terms', 'movements', 'invoices', 'payables', 'orders', 'freight_orders',
    'commodities', 'fields', 'storages', 'input_stock', 'spray_jobs', 'record_documents', 'overheads'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on %I', 'audit_' || t, t);
      execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row()', 'audit_' || t, t);
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261208000000_price_history.sql
-- ---------------------------------------------------------------------------
-- Price history: the weekly price of a commodity, with optional grade spreads (protein spreads on wheat, for example).
-- Kept on the commodity as a list, like the hay details are, so it travels with the farm's other data.
-- Safe to run more than once.
alter table commodities add column if not exists price_history jsonb;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261209000000_farm_switches.sql
-- ---------------------------------------------------------------------------
-- Switches a farm's owner can turn on, to change what a role can see. Safe to run more than once.
--
-- The standard rules stay exactly as they were: every switch is off until the owner turns it on, and a farm with every
-- switch off behaves as it did before this was run. The policies below do not change the existing ones. They sit beside
-- them:
--   - a permissive policy ADDS access (policies are joined with OR), used where a switch lets a role see more;
--   - a restrictive policy TAKES AWAY access (policies are joined with AND), used where a switch narrows a role.
-- To go back to the standard rules for good, drop the policies named here; nothing else was touched.
--
-- Switches (the key is what is saved in farms.switches):
--   managerSeesPrices      managers read contract prices and terms (sale_terms)
--   managerSeesOverheads   managers read overheads, so the whole farm's profit
--   workerSeesYields       (app only: yields are not held back from a worker by the database)
--   workerSeesPosition     (app only: a worker already reads the loads and contracts Position is built from)
--   driverOwnLoadsOnly     a driver sees only the loads they entered themselves

alter table farms add column if not exists switches jsonb not null default '{}'::jsonb;

-- Is a switch on for this farm? Missing, or anything but true, is off.
create or replace function app_switch(p_farm uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select f.switches ->> p_key = 'true' from farms f where f.id = p_farm and f.deleted_at is null), false)
$$;

-- managerSeesPrices: a manager reads the contract terms, where the price lives
drop policy if exists sale_terms_manager_switch on sale_terms;
create policy sale_terms_manager_switch on sale_terms for select
  using (app_role(farm_id) = 'manager' and app_switch(farm_id, 'managerSeesPrices') and deleted_at is null);

-- managerSeesOverheads: a manager reads the whole-farm overheads
drop policy if exists overheads_manager_switch on overheads;
create policy overheads_manager_switch on overheads for select
  using (app_role(farm_id) = 'manager' and app_switch(farm_id, 'managerSeesOverheads') and deleted_at is null);

-- driverOwnLoadsOnly: with the switch on, a driver is sent only the loads they entered, and the legs and photos of those
drop policy if exists movements_driver_own_only on movements;
create policy movements_driver_own_only on movements as restrictive for select
  using (not (app_role(farm_id) = 'driver' and app_switch(farm_id, 'driverOwnLoadsOnly')) or created_by = auth.uid());

drop policy if exists movement_legs_driver_own_only on movement_legs;
create policy movement_legs_driver_own_only on movement_legs as restrictive for select
  using (
    not (app_role(farm_id) = 'driver' and app_switch(farm_id, 'driverOwnLoadsOnly'))
    or exists (select 1 from movements m where m.id = movement_id and m.created_by = auth.uid())
  );

drop policy if exists movement_photos_driver_own_only on movement_photos;
create policy movement_photos_driver_own_only on movement_photos as restrictive for select
  using (
    not (app_role(farm_id) = 'driver' and app_switch(farm_id, 'driverOwnLoadsOnly'))
    or exists (select 1 from movements m where m.id = movement_id and m.created_by = auth.uid())
  );

notify pgrst, 'reload schema';

