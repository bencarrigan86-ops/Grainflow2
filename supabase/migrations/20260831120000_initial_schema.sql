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
