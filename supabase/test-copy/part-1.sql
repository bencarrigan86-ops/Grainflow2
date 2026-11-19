-- Test database, part 1 of 4: 20260831120000_initial_schema.sql to 20260901160000_contract_terms.sql.
-- Paste ALL of this into the Supabase SQL editor of the TEST project and press Run. Run the parts in order.

-- ---------------------------------------------------------------------------
-- 20260831120000_initial_schema.sql
-- ---------------------------------------------------------------------------
-- Grainflow — initial schema
--
-- Six decisions are baked in here and each one is expensive to retrofit:
--
--   1. Primary keys are client-generated UUIDs, never sequences. A phone with
--      no signal has to create a movement without asking the server for an id.
--   2. Human-readable numbers (ticket, invoice) are leased in blocks via
--      number_leases, because a server sequence cannot assign while a device
--      is offline. The internal key and the printed number are separate things.
--   3. Nothing is ever hard-deleted. deleted_at is stamped and the row stays —
--      a row deleted offline cannot be reconciled against edits made elsewhere.
--   4. Corrections are new rows, not edits. movements.corrects_id links an
--      adjusting entry to the ticket it amends, the way a trade amendment does.
--   5. No aggregate or computed total is stored anywhere. Position, tonnes on
--      hand and margins are always derived from rows. A stored total that two
--      devices both update is a conflict with no correct resolution.
--   6. When a role needs some of a row but not all of it, the row is split.
--      sale_terms and field_agronomy exist so contract prices and the agronomy
--      program can be withheld from a field device as whole tables, rather than
--      filtered columns — column filtering does not translate into sync rules.
--
-- Two conventions worth knowing before you read on:
--
--   farm_id is repeated on every table even where it is implied by a parent.
--   That is deliberate: every security policy and every sync rule keys off it,
--   and a single-column check is both faster and much harder to get wrong than
--   a join back up the tree.
--
--   Constrained values are text + CHECK rather than Postgres enums. Enums are
--   tidier but altering them later is awkward, and this schema will change.

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at honest
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

create table farms (
  id                  uuid primary key,
  entity_name         text not null,
  abn                 text,
  ngr                 text,
  contact_name        text,
  phone               text,
  email               text,
  address             text,
  payment_terms_days  integer not null default 14,
  bank_name           text,
  account_name        text,
  bsb                 text,
  account_number      text,
  -- Flat annual plan plus a variable $/t struck at season rollover.
  subscription_status text not null default 'trial'
                      check (subscription_status in ('trial','active','past_due','expired')),
  trial_ends_at       timestamptz,
  stripe_customer_id  text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  updated_by          uuid,
  deleted_at          timestamptz
);

-- Every policy in the database resolves through this table. can_write_production
-- is the single flag separating a farm worker from a driver — five roles, three
-- policy families.
create table farm_users (
  id                   uuid primary key,
  farm_id              uuid not null references farms(id) on delete cascade,
  user_id              uuid not null references auth.users(id) on delete cascade,
  role                 text not null
                       check (role in ('owner','manager','bookkeeper','farm_worker','driver')),
  can_write_production boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid,
  updated_by           uuid,
  deleted_at           timestamptz,
  unique (farm_id, user_id)
);

-- How a driver joins without the owner sharing a password.
create table invitations (
  id                   uuid primary key,
  farm_id              uuid not null references farms(id) on delete cascade,
  email                text not null,
  role                 text not null
                       check (role in ('owner','manager','bookkeeper','farm_worker','driver')),
  can_write_production boolean not null default false,
  token                text not null unique,
  expires_at           timestamptz not null,
  accepted_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid,
  updated_by           uuid,
  deleted_at           timestamptz
);

-- ---------------------------------------------------------------------------
-- Number leasing
--
-- A device claims a block of numbers while it has signal and draws from it in
-- the paddock. Two devices offline at once cannot mint the same ticket number
-- because they hold different blocks.
-- ---------------------------------------------------------------------------

create table number_leases (
  id          uuid primary key,
  farm_id     uuid not null references farms(id) on delete cascade,
  kind        text not null check (kind in ('ticket','invoice')),
  device_id   text not null,
  block_start integer not null,
  block_end   integer not null,
  next_value  integer not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  deleted_at  timestamptz,
  check (block_end >= block_start),
  check (next_value between block_start and block_end + 1)
);

create index on number_leases (farm_id, kind, block_end desc);

-- ---------------------------------------------------------------------------
-- Seasons and reference data
-- ---------------------------------------------------------------------------

create table seasons (
  id         uuid primary key,
  farm_id    uuid not null references farms(id) on delete cascade,
  label      text not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  unique (farm_id, label)
);

create table commodities (
  id                uuid primary key,
  farm_id           uuid not null references farms(id) on delete cascade,
  season_id         uuid not null references seasons(id) on delete cascade,
  name              text not null,
  angle_of_repose   numeric(6,2) not null default 0,
  test_weight       numeric(6,3) not null default 0,
  n_per_tonne       numeric(8,2) not null default 0,
  mtm_price         numeric(12,2) not null default 0,
  opening_stock     numeric(14,3) not null default 0,
  retained_seed     numeric(14,3) not null default 0,
  gross_margin_cost numeric(12,2) not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  deleted_at        timestamptz
);

create index on commodities (farm_id, season_id);

-- ---------------------------------------------------------------------------
-- Paddocks
--
-- Split so a driver can pick the paddock a load came out of without receiving
-- the agronomy program — yields, urea rates and seed varieties are not a
-- contract carrier's business.
-- ---------------------------------------------------------------------------

create table fields (
  id           uuid primary key,
  farm_id      uuid not null references farms(id) on delete cascade,
  season_id    uuid not null references seasons(id) on delete cascade,
  name         text not null,
  area_ha      numeric(12,3) not null default 0,
  commodity_id uuid references commodities(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  updated_by   uuid,
  deleted_at   timestamptz
);

create index on fields (farm_id, season_id);

create table field_agronomy (
  id                    uuid primary key,
  farm_id               uuid not null references farms(id) on delete cascade,
  field_id              uuid not null references fields(id) on delete cascade,
  yield_t_ha            numeric(10,3) not null default 0,
  yield_mode            text not null default 'estimate'
                        check (yield_mode in ('estimate','actual')),
  urea_required_kg_ha   numeric(10,2) not null default 0,
  urea_applied_kg_ha    numeric(10,2) not null default 0,
  seed_variety          text,
  seed_rate_kg_ha       numeric(10,2) not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid,
  updated_by            uuid,
  deleted_at            timestamptz,
  unique (field_id)
);

create index on field_agronomy (farm_id);

-- ---------------------------------------------------------------------------
-- Storage
--
-- current_height and opening_stock are measurements, not aggregates — they are
-- entered, not computed. Tonnes on hand is always derived from movements.
-- ---------------------------------------------------------------------------

create table storages (
  id              uuid primary key,
  farm_id         uuid not null references farms(id) on delete cascade,
  season_id       uuid not null references seasons(id) on delete cascade,
  kind            text not null check (kind in ('silo','bunker')),
  name            text not null,
  commodity_id    uuid references commodities(id) on delete set null,
  radius          numeric(10,3),
  cone_angle      numeric(6,2),
  width           numeric(10,3),
  length          numeric(10,3),
  capacity_tons   numeric(14,3),
  angle_of_repose numeric(6,2),
  test_weight     numeric(6,3),
  tarp_overhang_m numeric(8,3),
  current_height  numeric(10,3) not null default 0,
  fill_state      text not null default 'peak' check (fill_state in ('peak','level')),
  opening_stock   numeric(14,3) not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  deleted_at      timestamptz
);

create index on storages (farm_id, season_id);

-- ---------------------------------------------------------------------------
-- Sales
--
-- Split for the same reason as fields: a driver must pick the contract they are
-- carting against, so they need buyer, commodity and tonnes — but never price,
-- terms or value. sale_terms simply never syncs to a field device.
-- ---------------------------------------------------------------------------

create table sales (
  id              uuid primary key,
  farm_id         uuid not null references farms(id) on delete cascade,
  season_id       uuid not null references seasons(id) on delete cascade,
  commodity_id    uuid references commodities(id) on delete set null,
  buyer           text,
  contract_no     text,
  grade           text,
  tonnes          numeric(14,3) not null default 0,
  delivery_period text,
  sale_date       date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  deleted_at      timestamptz
);

create index on sales (farm_id, season_id);

create table sale_terms (
  id                 uuid primary key,
  farm_id            uuid not null references farms(id) on delete cascade,
  sale_id            uuid not null references sales(id) on delete cascade,
  price              numeric(12,2) not null default 0,
  payment_terms_days integer,
  contract_value     numeric(14,2),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid,
  updated_by         uuid,
  deleted_at         timestamptz,
  unique (sale_id)
);

create index on sale_terms (farm_id);

-- ---------------------------------------------------------------------------
-- Movements
--
-- commodity_id is stored, not derived. It looks computable from the source
-- silo, but a silo's contents are current state while a ticket records what was
-- physically carted that day. Empty that silo in March, refill it with barley
-- in November, and every wheat ticket ever written against it would silently
-- become a barley ticket.
--
-- status gates the field-role policies: any field user may amend an open load,
-- because the truck may change hands mid-job; once closed it is read-only below
-- manager.
-- ---------------------------------------------------------------------------

create table movements (
  id            uuid primary key,
  farm_id       uuid not null references farms(id) on delete cascade,
  season_id     uuid not null references seasons(id) on delete cascade,
  ticket_no     integer,
  move_date     date,
  commodity_id  uuid references commodities(id) on delete set null,
  status        text not null default 'open' check (status in ('open','closed')),
  truck_rego    text,
  driver_name   text,
  gross_weight  numeric(14,3),
  tare_weight   numeric(14,3),
  tons          numeric(14,3) not null default 0,
  weight_status text not null default 'estimate' check (weight_status in ('estimate','final')),
  notes         text,
  -- Decision 4: a correction is a new adjusting row pointing at the original.
  corrects_id   uuid references movements(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  deleted_at    timestamptz,
  unique (farm_id, ticket_no)
);

create index on movements (farm_id, season_id);
create index on movements (farm_id, status);

-- The froms/tos arrays, normalised. A load can blend several sources and split
-- across several destinations.
create table movement_legs (
  id          uuid primary key,
  farm_id     uuid not null references farms(id) on delete cascade,
  movement_id uuid not null references movements(id) on delete cascade,
  direction   text not null check (direction in ('from','to')),
  ref_type    text not null check (ref_type in ('field','storage','sale')),
  ref_id      uuid,
  tons        numeric(14,3) not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  deleted_at  timestamptz
);

create index on movement_legs (farm_id, movement_id);

-- The row holds a path. The image lives in Supabase Storage, never here.
create table movement_photos (
  id           uuid primary key,
  farm_id      uuid not null references farms(id) on delete cascade,
  movement_id  uuid not null references movements(id) on delete cascade,
  storage_path text not null,
  taken_at     timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  updated_by   uuid,
  deleted_at   timestamptz
);

create index on movement_photos (farm_id, movement_id);

-- ---------------------------------------------------------------------------
-- Invoices
--
-- lines and totals are frozen snapshots, deliberately. Editing a sale price
-- later must never rewrite an invoice already sent to a buyer.
-- ---------------------------------------------------------------------------

create table invoices (
  id         uuid primary key,
  farm_id    uuid not null references farms(id) on delete cascade,
  season_id  uuid not null references seasons(id) on delete cascade,
  sale_id    uuid references sales(id) on delete set null,
  invoice_no integer,
  status     text not null default 'outstanding' check (status in ('outstanding','paid')),
  paid_date  date,
  lines      jsonb not null default '[]'::jsonb,
  totals     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  unique (farm_id, invoice_no)
);

create index on invoices (farm_id, season_id);

-- ---------------------------------------------------------------------------
-- Overheads — one row per season, owner and bookkeeper only
-- ---------------------------------------------------------------------------

create table overheads (
  id                   uuid primary key,
  farm_id              uuid not null references farms(id) on delete cascade,
  season_id            uuid not null references seasons(id) on delete cascade,
  finance              numeric(14,2) not null default 0,
  equipment_repayments numeric(14,2) not null default 0,
  depreciation         numeric(14,2) not null default 0,
  wages                numeric(14,2) not null default 0,
  drawings             numeric(14,2) not null default 0,
  admin                numeric(14,2) not null default 0,
  energy               numeric(14,2) not null default 0,
  insurance            numeric(14,2) not null default 0,
  repairs_maintenance  numeric(14,2) not null default 0,
  other                numeric(14,2) not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid,
  updated_by           uuid,
  deleted_at           timestamptz,
  unique (season_id)
);

create index on overheads (farm_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'farms','farm_users','invitations','number_leases','seasons','commodities',
    'fields','field_agronomy','storages','sales','sale_terms','movements',
    'movement_legs','movement_photos','invoices','overheads'
  ]
  loop
    execute format(
      'create trigger %I_set_updated_at before update on %I
         for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row-level security: ON for every table, with no policies yet.
--
-- Enabling RLS with zero policies denies everything, which is the correct
-- state to be in between this migration and the next. A table with RLS left
-- off is readable by anyone holding the publishable key — that is, everyone.
-- Policies arrive in the next migration (step 0.4).
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'farms','farm_users','invitations','number_leases','seasons','commodities',
    'fields','field_agronomy','storages','sales','sale_terms','movements',
    'movement_legs','movement_photos','invoices','overheads'
  ]
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 20260831130000_rls_policies.sql
-- ---------------------------------------------------------------------------
-- Grainflow — row-level security policies
--
-- Five roles, three policy families. The families are commercial (owner,
-- bookkeeper), operational (manager) and field (farm_worker, driver); the two
-- field roles differ in exactly one thing, which is why can_write_production is
-- a flag on farm_users rather than two separate policy sets.
--
-- Two rules run through everything below:
--
--   Nothing is hard-deleted, so there are no DELETE policies. A soft delete is
--   an UPDATE that stamps deleted_at, and it is governed by the UPDATE policy:
--   you may remove what you created, and owners and managers may remove
--   anyone's.
--
--   Restricted data is never merely hidden. sale_terms, field_agronomy,
--   overheads and invoices are absent from a field user's SELECT entirely, so
--   when Phase 3 adds sync rules there is nothing to leak — the rows never
--   reach the device.
--
-- Note the deliberate split between what a role can SEE and what appears in
-- their tab bar. A driver has no Production or Sales tab, but must still read
-- `fields` and `sales` to pick the paddock a load came out of and the contract
-- it is going against. The tab list is interface; this file is security.

-- ---------------------------------------------------------------------------
-- Helpers
--
-- security definer is not optional here. A policy on farm_users that selects
-- from farm_users would recurse forever; running the lookup as the definer
-- steps outside RLS and breaks the cycle. search_path is pinned because a
-- definer function with a mutable search_path is a privilege-escalation hole.
-- ---------------------------------------------------------------------------

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
   limit 1
$$;

create or replace function app_is_member(p_farm uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app_role(p_farm) is not null
$$;

create or replace function app_can_write_production(p_farm uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select can_write_production
       from farm_users
      where farm_id = p_farm
        and user_id = auth.uid()
        and deleted_at is null
      limit 1), false)
$$;

-- Owner and manager may act on anyone's records. Everyone else, their own.
create or replace function app_may_manage_row(p_farm uuid, p_created_by uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app_role(p_farm) in ('owner','manager')
      or p_created_by = auth.uid()
$$;

-- Signing up is a chicken-and-egg problem: you cannot insert a farm you are not
-- yet a member of, and you cannot be a member of a farm that does not exist.
-- This does both in one transaction, as the definer.
create or replace function create_farm(p_farm_id uuid, p_entity_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into farms (id, entity_name, created_by, updated_by, trial_ends_at)
  values (p_farm_id, p_entity_name, auth.uid(), auth.uid(), now() + interval '1 year');

  insert into farm_users (id, farm_id, user_id, role, can_write_production, created_by, updated_by)
  values (gen_random_uuid(), p_farm_id, auth.uid(), 'owner', true, auth.uid(), auth.uid());

  return p_farm_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- farms — every member reads; only the owner edits
-- ---------------------------------------------------------------------------

create policy farms_select on farms for select
  using (app_is_member(id) and deleted_at is null);

create policy farms_update on farms for update
  using (app_role(id) = 'owner')
  with check (app_role(id) = 'owner');

-- ---------------------------------------------------------------------------
-- farm_users and invitations — the owner runs the roster
-- ---------------------------------------------------------------------------

create policy farm_users_select on farm_users for select
  using (app_is_member(farm_id) and deleted_at is null);

create policy farm_users_insert on farm_users for insert
  with check (app_role(farm_id) = 'owner');

create policy farm_users_update on farm_users for update
  using (app_role(farm_id) = 'owner')
  with check (app_role(farm_id) = 'owner');

create policy invitations_select on invitations for select
  using (app_role(farm_id) = 'owner' and deleted_at is null);

create policy invitations_insert on invitations for insert
  with check (app_role(farm_id) = 'owner');

create policy invitations_update on invitations for update
  using (app_role(farm_id) = 'owner')
  with check (app_role(farm_id) = 'owner');

-- ---------------------------------------------------------------------------
-- number_leases — any member may lease, because any member may create a ticket
-- ---------------------------------------------------------------------------

create policy number_leases_select on number_leases for select
  using (app_is_member(farm_id) and deleted_at is null);

create policy number_leases_insert on number_leases for insert
  with check (app_is_member(farm_id));

create policy number_leases_update on number_leases for update
  using (app_is_member(farm_id))
  with check (app_is_member(farm_id));

-- ---------------------------------------------------------------------------
-- seasons, commodities, storages — everyone reads, owner and manager write
--
-- Drivers read storages because they must pick the silo they are tipping into.
-- ---------------------------------------------------------------------------

create policy seasons_select on seasons for select
  using (app_is_member(farm_id) and deleted_at is null);
create policy seasons_insert on seasons for insert
  with check (app_role(farm_id) in ('owner','manager'));
create policy seasons_update on seasons for update
  using (app_role(farm_id) in ('owner','manager'))
  with check (app_role(farm_id) in ('owner','manager'));

create policy commodities_select on commodities for select
  using (app_is_member(farm_id) and deleted_at is null);
create policy commodities_insert on commodities for insert
  with check (app_role(farm_id) in ('owner','manager'));
create policy commodities_update on commodities for update
  using (app_role(farm_id) in ('owner','manager'))
  with check (app_role(farm_id) in ('owner','manager'));

create policy storages_select on storages for select
  using (app_is_member(farm_id) and deleted_at is null);
create policy storages_insert on storages for insert
  with check (app_role(farm_id) in ('owner','manager'));
create policy storages_update on storages for update
  using (app_role(farm_id) in ('owner','manager'))
  with check (app_role(farm_id) in ('owner','manager'));

-- ---------------------------------------------------------------------------
-- fields — everyone reads the paddock list; the agronomy behind it is narrower
-- ---------------------------------------------------------------------------

create policy fields_select on fields for select
  using (app_is_member(farm_id) and deleted_at is null);

create policy fields_insert on fields for insert
  with check (
    app_role(farm_id) in ('owner','manager')
    or (app_role(farm_id) = 'farm_worker' and app_can_write_production(farm_id))
  );

create policy fields_update on fields for update
  using (
    (app_role(farm_id) in ('owner','manager')
     or (app_role(farm_id) = 'farm_worker' and app_can_write_production(farm_id)))
    and app_may_manage_row(farm_id, created_by)
  )
  with check (
    app_role(farm_id) in ('owner','manager')
    or (app_role(farm_id) = 'farm_worker' and app_can_write_production(farm_id))
  );

-- A driver never receives this table at all — it is the agronomy program, and
-- a contract carrier has no business with it.
create policy field_agronomy_select on field_agronomy for select
  using (
    app_role(farm_id) in ('owner','manager','bookkeeper','farm_worker')
    and deleted_at is null
  );

create policy field_agronomy_insert on field_agronomy for insert
  with check (
    app_role(farm_id) in ('owner','manager')
    or (app_role(farm_id) = 'farm_worker' and app_can_write_production(farm_id))
  );

create policy field_agronomy_update on field_agronomy for update
  using (
    (app_role(farm_id) in ('owner','manager')
     or (app_role(farm_id) = 'farm_worker' and app_can_write_production(farm_id)))
    and app_may_manage_row(farm_id, created_by)
  )
  with check (
    app_role(farm_id) in ('owner','manager')
    or (app_role(farm_id) = 'farm_worker' and app_can_write_production(farm_id))
  );

-- ---------------------------------------------------------------------------
-- sales and sale_terms
--
-- Everyone reads `sales`, including the driver — they must pick the contract
-- they are carting against. Nobody outside owner and bookkeeper reads
-- `sale_terms`, which is where the price lives. That split is the entire reason
-- these are two tables.
-- ---------------------------------------------------------------------------

create policy sales_select on sales for select
  using (app_is_member(farm_id) and deleted_at is null);

create policy sales_insert on sales for insert
  with check (app_role(farm_id) in ('owner','bookkeeper'));

create policy sales_update on sales for update
  using (app_role(farm_id) in ('owner','bookkeeper')
         and app_may_manage_row(farm_id, created_by))
  with check (app_role(farm_id) in ('owner','bookkeeper'));

create policy sale_terms_select on sale_terms for select
  using (app_role(farm_id) in ('owner','bookkeeper') and deleted_at is null);

create policy sale_terms_insert on sale_terms for insert
  with check (app_role(farm_id) in ('owner','bookkeeper'));

create policy sale_terms_update on sale_terms for update
  using (app_role(farm_id) in ('owner','bookkeeper')
         and app_may_manage_row(farm_id, created_by))
  with check (app_role(farm_id) in ('owner','bookkeeper'));

-- ---------------------------------------------------------------------------
-- movements
--
-- A load is a hand-off, not a personal record: the worker loads out of the
-- silo, the driver carts it, someone else tips it. So any field user may amend
-- any movement still open. Once it is closed it is read-only below manager.
--
-- Note the asymmetry with removal — amending a live ticket is collaborative,
-- destroying a record is not, so a soft delete still runs through
-- app_may_manage_row.
-- ---------------------------------------------------------------------------

create policy movements_select on movements for select
  using (app_is_member(farm_id) and deleted_at is null);

create policy movements_insert on movements for insert
  with check (app_role(farm_id) in ('owner','manager','farm_worker','driver'));

create policy movements_update on movements for update
  using (
    app_role(farm_id) in ('owner','manager')
    or (
      app_role(farm_id) in ('farm_worker','driver')
      and status = 'open'
      and (created_by = auth.uid() or deleted_at is null)
    )
  )
  with check (
    app_role(farm_id) in ('owner','manager')
    or (
      app_role(farm_id) in ('farm_worker','driver')
      and status = 'open'
      and (deleted_at is null or created_by = auth.uid())
    )
  );

create policy movement_legs_select on movement_legs for select
  using (app_is_member(farm_id) and deleted_at is null);

create policy movement_legs_insert on movement_legs for insert
  with check (app_role(farm_id) in ('owner','manager','farm_worker','driver'));

create policy movement_legs_update on movement_legs for update
  using (
    app_role(farm_id) in ('owner','manager')
    or (app_role(farm_id) in ('farm_worker','driver')
        and exists (select 1 from movements m
                     where m.id = movement_id and m.status = 'open'))
  )
  with check (app_role(farm_id) in ('owner','manager','farm_worker','driver'));

create policy movement_photos_select on movement_photos for select
  using (app_is_member(farm_id) and deleted_at is null);

create policy movement_photos_insert on movement_photos for insert
  with check (app_role(farm_id) in ('owner','manager','farm_worker','driver'));

create policy movement_photos_update on movement_photos for update
  using (app_may_manage_row(farm_id, created_by))
  with check (app_is_member(farm_id));

-- ---------------------------------------------------------------------------
-- invoices and overheads — the commercial family only
--
-- The manager is excluded from overheads deliberately: it is what makes their
-- Position screen show tonnes and margin per paddock without whole-farm gross
-- margin. Withholding the table is how that is enforced, not hiding a panel.
-- ---------------------------------------------------------------------------

create policy invoices_select on invoices for select
  using (app_role(farm_id) in ('owner','bookkeeper') and deleted_at is null);
create policy invoices_insert on invoices for insert
  with check (app_role(farm_id) in ('owner','bookkeeper'));
create policy invoices_update on invoices for update
  using (app_role(farm_id) in ('owner','bookkeeper')
         and app_may_manage_row(farm_id, created_by))
  with check (app_role(farm_id) in ('owner','bookkeeper'));

create policy overheads_select on overheads for select
  using (app_role(farm_id) in ('owner','bookkeeper') and deleted_at is null);
create policy overheads_insert on overheads for insert
  with check (app_role(farm_id) in ('owner','bookkeeper'));
create policy overheads_update on overheads for update
  using (app_role(farm_id) in ('owner','bookkeeper'))
  with check (app_role(farm_id) in ('owner','bookkeeper'));

-- ---------------------------------------------------------------------------
-- Grants
--
-- RLS narrows what a role may touch; it does not grant the right to touch
-- anything in the first place. Note there is no DELETE grant anywhere — the
-- schema is soft-delete only, and withholding the privilege makes that
-- structural rather than a convention someone forgets.
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

alter default privileges in schema public
  grant select, insert, update on tables to authenticated;

-- ---------------------------------------------------------------------------
-- 20260831140000_photo_storage.sql
-- ---------------------------------------------------------------------------
-- Movement photos move out of the row and into object storage.
--
-- Until now a photo was a base64 data URL living inside the movement itself.
-- That is what produced this app's "device storage may be full" alert: a dozen
-- truck photos will exhaust localStorage on their own, and every one of them
-- also has to travel in every sync of the whole farm.
--
-- The bucket is private. Nothing is served by public URL — the app asks for a
-- short-lived signed URL each time it needs to display one, so a photo cannot
-- be shared by copying a link out of the page source.
--
-- Path convention, and the policies below depend on it:
--
--     <farm_id>/<movement_id>/<uuid>.jpg
--
-- The first segment is the farm. That is what makes an object's ownership
-- decidable without a join, which is the only thing storage policies can
-- reasonably do.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'movement-photos',
  'movement-photos',
  false,
  5 * 1024 * 1024,                      -- 5MB; img.js compresses to well under this
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Compare the leading path segment as text rather than casting it to uuid.
-- A malformed object name would make a cast raise, and an erroring policy is
-- indistinguishable from a denying one right up until it is not.
create or replace function app_farm_ids_text()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select farm_id::text
    from farm_users
   where user_id = auth.uid()
     and deleted_at is null
$$;

-- Anyone on the farm may look at its photos — a driver needs to see the ticket
-- they just photographed, and there is nothing commercially sensitive in a
-- picture of a rego plate.
create policy "movement photos are readable by farm members"
on storage.objects for select
to authenticated
using (
  bucket_id = 'movement-photos'
  and (storage.foldername(name))[1] in (select app_farm_ids_text())
);

-- Writing mirrors the movements table: the roles that can log a load can
-- attach a photo to it. Bookkeepers cannot, because they cannot create
-- movements either.
create policy "movement photos are writable by movement-creating roles"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'movement-photos'
  and (storage.foldername(name))[1] in (select app_farm_ids_text())
  and app_role((storage.foldername(name))[1]::uuid)
      in ('owner', 'manager', 'farm_worker', 'driver')
);

create policy "movement photos are replaceable by movement-creating roles"
on storage.objects for update
to authenticated
using (
  bucket_id = 'movement-photos'
  and (storage.foldername(name))[1] in (select app_farm_ids_text())
)
with check (
  bucket_id = 'movement-photos'
  and (storage.foldername(name))[1] in (select app_farm_ids_text())
);

-- Object deletion is allowed where row deletion is not, and deliberately so.
-- The movement row is the record and stays soft-deleted forever; the image is
-- a large attachment with no evidentiary value once its ticket is gone, and
-- keeping orphaned photos is how a storage bill grows for no reason.
create policy "movement photos are removable by owners and managers"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'movement-photos'
  and (storage.foldername(name))[1] in (select app_farm_ids_text())
  and app_role((storage.foldername(name))[1]::uuid) in ('owner', 'manager')
);

-- ---------------------------------------------------------------------------
-- 20260831150000_fix_storage_policy_paths.sql
-- ---------------------------------------------------------------------------
-- Schema-qualify the helper calls in the storage policies.
--
-- The previous migration called app_role() and app_farm_ids_text() unqualified.
-- Policies on storage.objects are evaluated in the storage schema's context,
-- and public is not reliably on the search path there — so the call can fail to
-- resolve, the policy raises instead of returning false, and every upload is
-- refused with a message that looks like a permissions problem rather than a
-- missing function.
--
-- Setting search_path inside the functions does not help: that governs what the
-- function body can see once it is running, not whether the caller can find the
-- function in the first place.

drop policy if exists "movement photos are readable by farm members" on storage.objects;
drop policy if exists "movement photos are writable by movement-creating roles" on storage.objects;
drop policy if exists "movement photos are replaceable by movement-creating roles" on storage.objects;
drop policy if exists "movement photos are removable by owners and managers" on storage.objects;

create policy "movement photos are readable by farm members"
on storage.objects for select
to authenticated
using (
  bucket_id = 'movement-photos'
  and (storage.foldername(name))[1] in (select public.app_farm_ids_text())
);

create policy "movement photos are writable by movement-creating roles"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'movement-photos'
  and (storage.foldername(name))[1] in (select public.app_farm_ids_text())
  and public.app_role((storage.foldername(name))[1]::uuid)
      in ('owner', 'manager', 'farm_worker', 'driver')
);

create policy "movement photos are replaceable by movement-creating roles"
on storage.objects for update
to authenticated
using (
  bucket_id = 'movement-photos'
  and (storage.foldername(name))[1] in (select public.app_farm_ids_text())
)
with check (
  bucket_id = 'movement-photos'
  and (storage.foldername(name))[1] in (select public.app_farm_ids_text())
);

create policy "movement photos are removable by owners and managers"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'movement-photos'
  and (storage.foldername(name))[1] in (select public.app_farm_ids_text())
  and public.app_role((storage.foldername(name))[1]::uuid) in ('owner', 'manager')
);

-- The authenticated role also needs to be able to call them from that context.
grant execute on function public.app_farm_ids_text() to authenticated;
grant execute on function public.app_role(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 20260831160000_fix_storage_enums.sql
-- ---------------------------------------------------------------------------
-- Widen two storage constraints to match the vocabulary the app actually uses.
--
-- Both of these were my error, not bad data. When the schema was written I
-- guessed at the values instead of reading them out of views/storage.js:
--
--   fill_state   schema said  peak, level
--                app writes   peak, flat, decline
--
--   kind         schema said  silo, bunker
--                app writes   silo, bunker, tally
--
-- 'level' has never existed anywhere in the app. 'flat' and 'decline' are the
-- two surfaces a silo actually presents — filled to a cone, struck level, or
-- drawn down into a funnel — and the volume maths in calc.js treats them as
-- three different shapes, so this is not cosmetic. 'tally' is a count-based
-- store (cotton round and lint bales) that the ginning flow in movements.js
-- depends on; without it, creating one is rejected at the database.
--
-- ORDER MATTERS HERE, and I got it wrong twice before getting it right:
--
--   attempt 1   constraint first          — failed, existing rows held 'level'
--   attempt 2   update, then constraint   — failed, the update wrote 'flat'
--                                           while the old constraint was still
--                                           in force and rejected it
--   attempt 3   drop, update, add         — this one
--
-- A check constraint polices every write, including the write that exists to
-- make the rows legal. So the old rule comes off before the data moves, and
-- the new rule goes on after.

-- ---------------------------------------------------------------------------
-- 1. Take the old rules off.
-- ---------------------------------------------------------------------------

alter table storages drop constraint if exists storages_fill_state_check;
alter table storages drop constraint if exists storages_kind_check;

-- ---------------------------------------------------------------------------
-- 2. Normalise the one value that should never have existed.
--
-- 'level' can only have come from the constraint I invented — no build of the
-- app has ever written it, and the storage editor cannot render it (it falls
-- through to 'peak' and shows the wrong volume). 'flat' is what it was
-- standing in for, so that is where it goes.
--
-- Note what is deliberately absent: a catch-all that rewrites anything
-- unexpected to the default. If some other value is in that column I want the
-- step below to fail and show me, rather than silently overwrite a row I have
-- never looked at. A migration that cannot fail is a migration that cannot
-- tell you it was wrong.
--
-- kind needs no equivalent: the rule it replaces allowed only 'silo' and
-- 'bunker', both of which stay legal, so nothing can be stranded.
-- ---------------------------------------------------------------------------

update storages set fill_state = 'flat' where fill_state = 'level';

-- ---------------------------------------------------------------------------
-- 3. Put the correct rules on.
-- ---------------------------------------------------------------------------

alter table storages add constraint storages_fill_state_check
  check (fill_state in ('peak','flat','decline'));

alter table storages add constraint storages_kind_check
  check (kind in ('silo','bunker','tally'));

-- ---------------------------------------------------------------------------
-- 20260831170000_missing_columns.sql
-- ---------------------------------------------------------------------------
-- The 27 values the app saves and the database had nowhere to put.
--
-- Found by tests/roundtrip.test.mjs, which reads the object literals the views
-- actually pass to db.upsertField(), db.upsertSale() and the rest, sends them
-- through mapping.js to rows and back, and reports what does not come home.
-- Nothing here is my idea of what a paddock or a contract has on it; every
-- column below exists because a form writes it.
--
-- The shape of the mistake is worth recording, because it was not one missing
-- column. The mapping was reading `sale.tonnes`, `sale.deliveryPeriod`,
-- `sale.paymentTermsDays` and `sale.contractValue` — none of which any build of
-- the app has ever written — while `tons`, `deliveryStart`, `deliveryEnd`,
-- `freight`, `premiumDiscount`, `ginning`, `leviesPct`, the tolerance pair, the
-- broker note and the buyer's ABN and address were all discarded on push. The
-- schema was written from an imagined app rather than the real one, and every
-- loss was silent: no error, no warning, the value simply absent after the next
-- sync.
--
-- The split follows the one the schema already makes. `sales` and `fields` are
-- what a field device may hold; `sale_terms` and `field_agronomy` are withheld
-- as whole tables. So delivery quantities, dates, location and tolerance sit
-- with the load, and anything that adds up to margin sits behind the wall.

-- ---------------------------------------------------------------------------
-- Paddocks
--
-- notes rides on `fields` because a note about access, a boggy corner or a gate
-- is exactly what the person carting needs. The agronomy program does not.
-- ---------------------------------------------------------------------------

alter table fields
  add column if not exists notes text;

alter table field_agronomy
  add column if not exists soil_test_n_kg_ha        numeric(10,2) not null default 0,
  add column if not exists target_yield_override_t_ha numeric(10,3) not null default 0,
  add column if not exists starter_required_kg_ha   numeric(10,2) not null default 0,
  add column if not exists starter_applied_kg_ha    numeric(10,2) not null default 0,
  -- Dated applications, not a single running total: [{date, kgHa}, …]. Kept as
  -- jsonb rather than a fifth table because nothing queries across them — they
  -- are read back with the paddock and displayed as a list. If that changes,
  -- this becomes a table and the jsonb migrates into it.
  add column if not exists urea_applications        jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- Contracts — the operational half
--
-- tons maps onto the existing `tonnes` column; the app spells it the American
-- way and the column the British way, which cost nothing to reconcile in the
-- mapping and would cost a rewrite to reconcile here.
-- ---------------------------------------------------------------------------

alter table sales
  add column if not exists location           text,
  add column if not exists delivery_start     date,
  add column if not exists delivery_end       date,
  add column if not exists tons_delivered     numeric(14,3) not null default 0,
  add column if not exists tolerance_pct      numeric(6,3)  not null default 0,
  add column if not exists tolerance_cap_tons numeric(14,3) not null default 0,
  add column if not exists notes              text;

-- delivery_period, sale_terms.payment_terms_days and sale_terms.contract_value
-- are left in place but nothing writes them: they were columns for an app that
-- does not exist. Left rather than dropped because dropping is irreversible and
-- they cost nothing; flagged here so the next reader does not mistake an empty
-- column for a missing feature.

-- ---------------------------------------------------------------------------
-- Contracts — the commercial half
--
-- Everything that moves the margin. Withheld from field devices by virtue of
-- living in sale_terms at all; no policy change is needed.
--
-- premium_discount is deliberately signed: a discount is a negative premium,
-- and the form allows it.
-- ---------------------------------------------------------------------------

alter table sale_terms
  add column if not exists freight          numeric(12,2) not null default 0,
  add column if not exists premium_discount numeric(12,2) not null default 0,
  add column if not exists ginning          numeric(14,2) not null default 0,
  -- Stored as a fraction, not a percentage — the form divides by 100 on the way
  -- in. 0.0102, not 1.02.
  add column if not exists levies_pct       numeric(8,6)  not null default 0,
  add column if not exists broker_note      text,
  add column if not exists buyer_abn        text,
  add column if not exists buyer_address    text;

-- ---------------------------------------------------------------------------
-- Commodities and storage
-- ---------------------------------------------------------------------------

alter table commodities
  add column if not exists unit                 text not null default 't',
  add column if not exists bales_per_round_bale numeric(8,2)  not null default 0,
  add column if not exists default_yield_t_ha   numeric(10,3) not null default 0,
  add column if not exists target_yield_t_ha    numeric(10,3) not null default 0,
  add column if not exists notes                text;

alter table storages
  -- What a tally store counts: round bales, lint bales, or tonnes.
  add column if not exists unit_label text not null default 't';

-- ---------------------------------------------------------------------------
-- 20260901100000_invitations.sql
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 20260901120000_farm_name.sql
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 20260901140000_my_invitations.sql
-- ---------------------------------------------------------------------------
-- Finding the invitation that was sent to you.
--
-- An invitation could only be spent by opening its link, and the link put the
-- token in that browser's localStorage. Everything else about the flow was
-- correct and it still failed the first time a real person used it: he went to
-- the app's address rather than opening the link, was shown "name your farm"
-- because he belonged to none, and created one. He then opened the link and
-- accepted properly — and finished with two farms, opening into the empty one.
--
-- Going to the website instead of clicking the link is not a mistake, it is
-- what most people will do. The invitation is addressed to an email; once
-- somebody is signed in as that email the app should be able to find it without
-- being handed a token.
--
-- Definer, because the invitee cannot read the invitations table — the select
-- policy is owners only, and rightly so: it holds every pending token for the
-- farm. This returns only rows addressed to the caller's own address, which is
-- the same test accept_invitation() already applies before writing anything.

create or replace function invitations_for_me()
returns table (
  id         uuid,
  farm_id    uuid,
  farm_name  text,
  role       text,
  token      text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select i.id, i.farm_id,
         coalesce(nullif(f.farm_name, ''), nullif(f.entity_name, ''), 'a farm')::text,
         i.role,
         -- Their own token, for their own invitation. Handing it back is what
         -- lets the Join button call accept_invitation() without the link, and
         -- it grants nothing they were not already sent by text message.
         i.token,
         i.expires_at
    from invitations i
    join farms f on f.id = i.farm_id
    join auth.users u on u.id = auth.uid()
   where lower(i.email) = lower(u.email)
     and i.deleted_at is null
     and i.accepted_at is null
     and i.expires_at > now()
   order by i.created_at desc;
$$;

revoke all on function invitations_for_me() from public;
grant execute on function invitations_for_me() to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20260901160000_contract_terms.sql
-- ---------------------------------------------------------------------------
-- What a real grain contract actually says.
--
-- Six live purchase contracts — Bunge, Cargill, Louis Dreyfus, CL Commodities,
-- KB Agri, Network Grains — all confirming trades brokered by the same broker,
-- all laid out differently, and all carrying the same dozen terms that this
-- schema had nowhere to put. Buyer, contract number, grade, tonnes, price,
-- delivery window and tolerance were already here. Everything below was being
-- lost, or crammed into the notes field.
--
-- These are not decorations. The carry charge is $2.50/MT/month against 1,500
-- tonnes; the broker reference is what the broker's own paperwork is filed
-- under; "weights to govern: destination" decides whose weighbridge settles an
-- argument about a load. A grower who cannot record them has to keep the PDF
-- open beside the app, which is the thing this is supposed to replace.
--
-- The split follows the one the schema already makes and for the same reason.
-- `sales` is what a field device may hold: what is being carted, where, when.
-- `sale_terms` is withheld: anything that moves the margin or names the money.
-- Brokerage and carry are commercial, so they go in the withheld half; the
-- delivery basis and whose weights govern are operational, so they do not.

alter table sales
  -- "2025/2026" as the contract writes it. The app's own season is a single
  -- label chosen by the grower ("2026"); the crop year is the buyer's, and on a
  -- document that has to be quoted back it needs to match theirs, not ours.
  add column if not exists crop_year        text,
  -- "Ex Farm", "Delivered Buyer", "Standard Fixed Grade".
  add column if not exists contract_type    text,
  -- Where the price is struck, which is not always where the grain goes:
  -- "Goondiwindi - 45km S/W" is a pricing point, "Delivered Brisbane" is a
  -- destination. `location` already holds the latter.
  add column if not exists pricing_point    text,
  -- 'destination' or 'origin'. Whose weighbridge settles a dispute.
  add column if not exists weights_to_govern text,
  -- "Buyers Call, 5 business days notice" — free text, because every issuer
  -- words it differently and an enum would refuse a real contract.
  add column if not exists delivery_terms   text,
  -- The trader or grower-services contact named on the document, so a query
  -- about the load does not start with hunting for the PDF.
  add column if not exists buyer_contact    text;

alter table sale_terms
  add column if not exists broker            text,
  -- The broker's own reference. Their paperwork is filed under it, and it is
  -- the fastest way to reconcile their statement against yours.
  add column if not exists broker_ref        text,
  -- 'seller' or 'buyer'. Seller on every one of the six.
  add column if not exists brokerage_paid_by text,
  -- Carry: the buyer pays to leave grain on farm past a date. Two contracts of
  -- the six carry $2.50/MT/month, which against 1,500 tonnes is $3,750 a month
  -- that nothing in this app could previously record.
  add column if not exists carry_rate        numeric(10,2),
  add column if not exists carry_from        date,
  -- payment_terms_days already exists and is not enough on its own: "30 days"
  -- from the delivery date and "30 days from the end of the week of delivery"
  -- are up to six days apart, which matters when it is the difference between
  -- one month's interest and the next.
  add column if not exists payment_terms_basis text,
  -- "GTA contract 3", "GTA Grower Contract 6", "Cargill GT&C 22 Aug 2024".
  -- Which rulebook governs is the first question in any dispute.
  add column if not exists trade_rules       text;

