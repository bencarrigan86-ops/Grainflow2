-- Test database, part 2 of 4: 20260901180000_sale_documents.sql to 20261116140000_delivery_pattern.sql.
-- Paste ALL of this into the Supabase SQL editor of the TEST project and press Run. Run the parts in order.

-- ---------------------------------------------------------------------------
-- 20260901180000_sale_documents.sql
-- ---------------------------------------------------------------------------
-- Keeping a copy of the buyer's contract and the broker's note.
--
-- A grower does not write these; they arrive by email and then live in an
-- inbox, which is where they are when somebody needs to check whether the
-- tolerance was 20 tonnes or 5%. The figures get typed into the app; the paper
-- they came from should sit beside them.
--
-- Storage follows the movement-photos migration exactly — private bucket,
-- farm_id as the leading path segment so ownership is decidable without a
-- join, signed URLs on demand — with one deliberate difference.
--
-- A photo of a rego plate is not commercially sensitive and every member of the
-- farm can see one. A purchase contract has the price on it. That puts it on
-- the sale_terms side of the line this schema already draws: owners, managers
-- and bookkeepers, not drivers and farm workers. A driver who could not read a
-- contract in the app but could open the PDF of it would make the whole split
-- decorative.

-- Every policy below is dropped before it is created. `create policy` has no
-- IF NOT EXISTS, so without this the file cannot be run twice — and a
-- migration that fails on a second run is one somebody re-runs at the worst
-- possible moment and then has to unpick by hand.
create table if not exists sale_documents (
  id            uuid primary key,
  farm_id       uuid not null references farms(id) on delete cascade,
  sale_id       uuid not null references sales(id) on delete cascade,
  -- What the document is, so the sale screen can label it rather than showing
  -- a list of filenames.
  kind          text not null default 'contract'
                check (kind in ('contract', 'broker_note', 'other')),
  -- The name as it arrived, because "Contract 672392.pdf" tells the grower
  -- which one it is and the storage path deliberately does not.
  file_name     text,
  storage_path  text not null,
  byte_size     integer,
  uploaded_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  deleted_at    timestamptz
);

create index if not exists sale_documents_farm_sale_idx
  on sale_documents (farm_id, sale_id);

alter table sale_documents enable row level security;

-- The farms this user may see commercial detail for. Distinct from
-- app_farm_ids_text(), which is every farm they belong to in any capacity —
-- that one is right for photos and wrong for contracts.
create or replace function app_commercial_farm_ids_text()
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
     and role in ('owner', 'manager', 'bookkeeper')
$$;

drop policy if exists sale_documents_select on sale_documents;
create policy sale_documents_select on sale_documents for select
  using (app_role(farm_id) in ('owner', 'manager', 'bookkeeper') and deleted_at is null);

drop policy if exists sale_documents_insert on sale_documents;
create policy sale_documents_insert on sale_documents for insert
  with check (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'));

drop policy if exists sale_documents_update on sale_documents;
create policy sale_documents_update on sale_documents for update
  using (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'))
  with check (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'));

-- ---------------------------------------------------------------------------
-- The bucket
--
-- 20MB rather than the photos' 5MB: the Network Grains contract in hand is
-- 1.8MB and a scanned one will be larger. PDFs and images both, because a
-- broker's note often arrives as a photograph of a piece of paper.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sale-documents',
  'sale-documents',
  false,
  20 * 1024 * 1024,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

drop policy if exists "sale documents are readable by owners, managers and bookkeepers" on storage.objects;
create policy "sale documents are readable by owners, managers and bookkeepers"
on storage.objects for select
to authenticated
using (
  bucket_id = 'sale-documents'
  and (storage.foldername(name))[1] in (select app_commercial_farm_ids_text())
);

drop policy if exists "sale documents are written by owners, managers and bookkeepers" on storage.objects;
create policy "sale documents are written by owners, managers and bookkeepers"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'sale-documents'
  and (storage.foldername(name))[1] in (select app_commercial_farm_ids_text())
);

drop policy if exists "sale documents are removed by owners, managers and bookkeepers" on storage.objects;
create policy "sale documents are removed by owners, managers and bookkeepers"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'sale-documents'
  and (storage.foldername(name))[1] in (select app_commercial_farm_ids_text())
);

-- ---------------------------------------------------------------------------
-- 20261111120000_storage_quality.sql
-- ---------------------------------------------------------------------------
-- What is in a silo: the grain's quality, not just its quantity.
--
-- A storage already says which commodity it holds and how many tonnes. What a
-- buyer asks about before anything else is what it is: the crop year, the grade
-- it has been classed as, and the measurements that grade rests on. Until now
-- those lived in the grower's head or on a sticker on the silo, which is fine
-- until a load has to be matched to a contract and the question is "which silo
-- is the APH1 at eleven percent protein".
--
-- Seven plain columns, all optional, all on storages:
--
--   crop_year           as the grower writes it, "2026/27". Text, because it is
--                       a label and the contracts' own crop_year is text too.
--   grade               "APH1", "BAR1". Text; the grades are the buyer's.
--   moisture_pct        percent
--   protein_pct         percent
--   screenings_pct      percent
--   test_weight_kg_hl   kilograms per hectolitre — what the grain weighs, as
--                       measured. NOT the same column as test_weight above,
--                       which is the density in tonnes per cubic metre used to
--                       turn a measured volume into tonnes. 78 kg/hL is 0.78 t/m3,
--                       but one is a result and the other is a setting.
--   falling_number      seconds
--
-- Nothing here is restricted: a field device reads storages already, and a
-- truck driver deciding which silo to unload into is exactly who wants to know.
--
-- Idempotent, like the others: running it twice is harmless.

alter table storages
  add column if not exists crop_year         text,
  add column if not exists grade             text,
  add column if not exists moisture_pct      numeric(6,2),
  add column if not exists protein_pct       numeric(6,2),
  add column if not exists screenings_pct    numeric(6,2),
  add column if not exists test_weight_kg_hl numeric(6,2),
  add column if not exists falling_number    numeric(7,1);

-- ---------------------------------------------------------------------------
-- 20261111130000_load_quality_and_silo_notes.sql
-- ---------------------------------------------------------------------------
-- What was on each truck, and a place to write things down about a silo.
--
-- Two small additions that belong together.
--
-- Load quality
--
-- A silo's contents are not one thing. They are the loads that went into it, one
-- after another, and each load may have been a different grade, protein or
-- moisture. To say what will come out of a silo when it is emptied — and in which
-- order — the quality of each load has to be on the load. These are the same six
-- measurements the silo itself can carry (see 20261111120000_storage_quality),
-- recorded against the movement that put the grain there:
--
--   grade, moisture_pct, protein_pct, screenings_pct, test_weight_kg_hl,
--   falling_number
--
-- All optional: most loads will have none recorded and the outload prediction
-- says so rather than guessing.
--
-- test_weight_kg_hl is the measured weight of the grain in kilograms per
-- hectolitre, as on storages — not a density setting.
--
-- Silo notes
--
-- A free-text note on a storage: which bin the auger sticks on, that the base is
-- being kept for seed, that the fan was off over the weekend. Commodities and
-- fields already have one; storages did not.
--
-- Idempotent, like the others: running it twice is harmless.

alter table movements
  add column if not exists grade             text,
  add column if not exists moisture_pct      numeric(6,2),
  add column if not exists protein_pct       numeric(6,2),
  add column if not exists screenings_pct    numeric(6,2),
  add column if not exists test_weight_kg_hl numeric(6,2),
  add column if not exists falling_number    numeric(7,1);

alter table storages
  add column if not exists notes text;

-- The other system's movement number
--
-- Loads brought in from the freight platform's export carry that platform's own
-- movement number (M…), so a load here can be found there, and the other way
-- round, by one unique id. Until now it was only written into the notes.

alter table movements
  add column if not exists source_ref text;

create index if not exists movements_source_ref_idx on movements (farm_id, source_ref)
  where source_ref is not null;

-- ---------------------------------------------------------------------------
-- 20261111150000_soft_delete_function.sql
-- ---------------------------------------------------------------------------
-- Deleting a record, which the server was refusing.
--
-- Nothing here is hard-deleted: removing a paddock, load or silo stamps
-- deleted_at on its row, and every table's SELECT policy only shows rows where
-- deleted_at is null. Postgres checks the *new* row of an UPDATE against the
-- SELECT policy as well as the UPDATE policy, so the update that stamps
-- deleted_at fails with "new row violates row-level security policy" — for
-- everyone, owner included. One refused delete then stopped every other
-- change on the device from being marked as sent.
--
-- This function does the stamping on the caller's behalf, as the definer, after
-- checking the same rule the UPDATE policies state: an owner or manager may
-- remove anyone's record, anyone else only what they created, and only
-- within a farm they belong to.
--
-- Idempotent: safe to run again.

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
    'sale_terms', 'sale_documents', 'movements', 'movement_legs',
    'movement_photos', 'invoices', 'overheads'
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
  if not (app_role(v_farm) in ('owner', 'manager') or v_created = auth.uid()) then
    raise exception 'not allowed';
  end if;

  execute format('update %I set deleted_at = now() where id = $1 and deleted_at is null', p_table) using p_id;
end;
$$;

revoke all on function soft_delete_row(text, uuid) from public;
grant execute on function soft_delete_row(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 20261111160000_opening_stock_value.sql
-- ---------------------------------------------------------------------------
-- What a season's opening stock was worth when the last season closed.
--
-- Carryover grain was already counted as income in the season that grew it, at
-- that season's mark-to-market price. Opening this season with the same tonnes
-- and no value would count it twice. This value is taken off this season's
-- total, so only what has changed since the close shows up here.
--
-- A dollar figure for the whole opening stock of the commodity (not $/t), because
-- it is the closing figure from last season, carried across as it stood.
--
-- Optional: nothing is stored unless it is entered. Idempotent.

alter table commodities
  add column if not exists opening_stock_value numeric(14,2);

-- ---------------------------------------------------------------------------
-- 20261112100000_storage_grade_bands.sql
-- ---------------------------------------------------------------------------
-- Running samples of a silo, by tonnes from the bottom.
--
-- Grain is sampled after harvest as it sits in the silo, not truck by truck: "the first
-- 800 t is APH1, 11.5% protein; the next 600 t is AUH2, 10.2%". This holds those
-- stretches, bottom first, with the date the samples were taken:
--
--   { "asOf": "2026-11-12",
--     "bands": [ { "tons": 800, "grade": "APH1", "proteinPct": 11.5, "moisturePct": 11.0,
--                  "screeningsPct": 1.2, "testWeightKgHl": 79.5, "fallingNumber": 400 }, ... ] }
--
-- They replace what the individual loads say for the grain they cover, so the silo can show
-- the grades in it and the outload predictor can say what each truck will carry. Loads
-- tipped in after the date keep their own grade.
--
-- Optional: nothing is stored unless a band is described. Idempotent.

alter table storages
  add column if not exists grade_bands jsonb;

-- ---------------------------------------------------------------------------
-- 20261113100000_commodity_custom_grades.sql
-- ---------------------------------------------------------------------------
-- A farm's own grades, per commodity.
--
-- The published grades for each commodity (APH1, Malt 1, SOR ...) are built into the app. A farm
-- can add grades of its own to any commodity, such as a buyer's house grade, and they appear
-- in the same dropdowns. They are kept here as a list of names:
--
--   [ "APW1 Plus", "Seed grade" ]
--
-- Optional: nothing is stored unless the farm has added one. Idempotent.

alter table commodities
  add column if not exists custom_grades jsonb;

-- ---------------------------------------------------------------------------
-- 20261113110000_sale_grade_options.sql
-- ---------------------------------------------------------------------------
-- A contract that lists several grades, each with its own premium or discount.
--
-- The contract's price is for the grade it names. This holds the others it will take, each with a
-- $/t adjustment on top of the price (negative for a discount):
--
--   [ { "grade": "APW1", "adjust": 0 }, { "grade": "H2", "adjust": 15 }, { "grade": "ASW1", "adjust": -20 } ]
--
-- Each load delivered is paid the price plus the adjustment for its own grade; a load whose grade is
-- not listed is paid the price as it stands. In sale_terms, with the other figures that move a
-- contract's value, so a field device never receives it.
--
-- Optional: nothing is stored unless a grade is listed. Idempotent.

alter table sale_terms
  add column if not exists grade_options jsonb;

-- ---------------------------------------------------------------------------
-- 20261113120000_canola_oil.sql
-- ---------------------------------------------------------------------------
-- Canola paid for its oil.
--
-- Oil content is measured on each load off the weighbridge sample, and on a silo's grain. A contract
-- can price for it: a base oil level (42% under the AOF terms) and the % of the price that moves for
-- every 1% of oil above or below it (1.5% under AOF). A load at 44% oil on a $700 contract is paid
-- 700 x 1.5% x 2 = $21/t over.
--
--   movements.oil_pct, storages.oil_pct       the oil, as a percentage
--   sale_terms.oil_base_pct                   the base oil level
--   sale_terms.oil_adjust_pct                 % of price per 1% of oil
--
-- With the other figures that move a contract's value, the terms are in sale_terms, so a field
-- device never receives them.
--
-- Optional: nothing is stored until oil is recorded or a contract is priced for it. Idempotent.

alter table movements
  add column if not exists oil_pct numeric(6,2);
alter table storages
  add column if not exists oil_pct numeric(6,2);
alter table sale_terms
  add column if not exists oil_base_pct numeric(6,2),
  add column if not exists oil_adjust_pct numeric(6,2);

-- ---------------------------------------------------------------------------
-- 20261113130000_off_farm_storage.sql
-- ---------------------------------------------------------------------------
-- Grain held off the farm by a third party, such as GrainCorp, and a receiving site's own ticket number.
--
-- A location is an ordinary storage row carrying this extra part:
--
--   { "operator": "GrainCorp",
--     "opening": [ { "commodityId": "...", "grade": "APH1", "tons": 450 }, ... ] }
--
-- the opening holdings by commodity and grade at the start of the season. Loads into and out of the
-- location are ordinary movements; what it holds now is the opening plus what has gone in, less what
-- has come out, for each commodity and grade.
--
-- external_ticket_no is the number on the receiving site's ticket, for a load that goes to another site.
--
-- Optional: nothing is stored unless a location is off-farm or a ticket number is recorded. Idempotent.

alter table storages
  add column if not exists off_farm jsonb;
alter table movements
  add column if not exists external_ticket_no text;

-- ---------------------------------------------------------------------------
-- 20261113140000_payables.sql
-- ---------------------------------------------------------------------------
-- Accounts payable: what the farm owes. Brokerage, freight invoices, storage at third-party sites, and
-- anything else. One row per bill.
--
--   kind        brokerage | freight | storage | other
--   supplier    who the bill is from (the broker, the carrier, GrainCorp ...)
--   reference   their invoice number
--   amount      the bill ex GST; gst is the GST on it
--   sale_id     the contract it is for, if any (brokerage and freight usually are)
--   storage_id  the off-farm location it is for, if any (storage fees)
--   tons, rate  the tonnes and $/t it was worked out on, when it was
--   status      unpaid | paid, with paid_date
--
-- Owners and bookkeepers only, like invoices: what the farm owes is commercial detail.
-- Optional columns and tables only: nothing is stored until a bill is recorded. Idempotent.

create table if not exists payables (
  id            uuid primary key,
  farm_id       uuid not null references farms(id) on delete cascade,
  season_id     uuid not null references seasons(id) on delete cascade,
  kind          text not null default 'other' check (kind in ('brokerage', 'freight', 'storage', 'other')),
  supplier      text,
  reference     text,
  invoice_date  date,
  due_date      date,
  amount        numeric(14,2) not null default 0,
  gst           numeric(14,2) not null default 0,
  sale_id       uuid references sales(id) on delete set null,
  storage_id    uuid references storages(id) on delete set null,
  tons          numeric(14,3),
  rate          numeric(12,4),
  status        text not null default 'unpaid' check (status in ('unpaid', 'paid')),
  paid_date     date,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  deleted_at    timestamptz
);

create index if not exists payables_farm_season_idx on payables (farm_id, season_id);

alter table payables enable row level security;

drop trigger if exists payables_set_updated_at on payables;
create trigger payables_set_updated_at before update on payables
  for each row execute function set_updated_at();

drop policy if exists payables_select on payables;
create policy payables_select on payables for select
  using (app_role(farm_id) in ('owner', 'bookkeeper') and deleted_at is null);

drop policy if exists payables_insert on payables;
create policy payables_insert on payables for insert
  with check (app_role(farm_id) in ('owner', 'bookkeeper'));

drop policy if exists payables_update on payables;
create policy payables_update on payables for update
  using (app_role(farm_id) in ('owner', 'bookkeeper'))
  with check (app_role(farm_id) in ('owner', 'bookkeeper'));

grant select, insert, update on payables to authenticated;

-- A contract's brokerage, in $/t, charged on the tonnes delivered. With the other figures that move
-- a contract's value it sits in sale_terms, so a field device never receives it.
alter table sale_terms
  add column if not exists brokerage_rate numeric(10,2);

-- Deleting a bill: the delete function has to know the new table.
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
    'sale_terms', 'sale_documents', 'movements', 'movement_legs',
    'movement_photos', 'invoices', 'overheads', 'payables'
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
  if not (app_role(v_farm) in ('owner', 'manager') or v_created = auth.uid()) then
    raise exception 'not allowed';
  end if;

  execute format('update %I set deleted_at = now() where id = $1 and deleted_at is null', p_table) using p_id;
end;
$$;

revoke all on function soft_delete_row(text, uuid) from public;
grant execute on function soft_delete_row(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 20261114100000_harvest_done.sql
-- ---------------------------------------------------------------------------
-- Whether harvest of a paddock is finished.
--
-- The harvest report compares what has been carted off a paddock with what it is expected to give. A paddock
-- that finished under its estimate would otherwise show tonnes still to come for ever; ticking it finished says
-- there is nothing more. Not an agronomy figure, so it is on fields itself, readable by anyone who can see the
-- paddock.
--
-- Optional: nothing is stored until it is set. Idempotent.

alter table fields
  add column if not exists harvest_done boolean;

-- ---------------------------------------------------------------------------
-- 20261114110000_harvest_ha_left.sql
-- ---------------------------------------------------------------------------
-- Hectares still to harvest on a part-harvested paddock.
--
-- A paddock can have tickets for most of its crop and still have some area to cut. Giving the hectares left lets
-- the harvest report count those hectares at the paddock's estimated yield, on top of the tonnes already in, rather
-- than working from the estimate for the whole paddock.
--
-- Optional: nothing is stored until it is set. Idempotent.

alter table fields
  add column if not exists harvest_ha_left numeric;

-- ---------------------------------------------------------------------------
-- 20261114120000_orders.sql
-- ---------------------------------------------------------------------------
-- Orders: a buyer asks for grain to be delivered against a contract.
--
-- The contract carries everything about the sale (buyer, commodity, grade, price, where it goes). An order is only
-- what changes from one order to the next: the tonnes, the window to deliver in, who is carting it, and the buyer's
-- own order number. A load names the order it was delivered against (movements.order_id), and what has been
-- delivered is worked out from those loads.
--
--   sale_id          the contract it is against
--   order_no         the buyer's order number
--   tons             tonnes ordered
--   deliver_from/by  the window
--   freight_company  who is carting it
--   status           open | closed (closed by hand: cancelled, or the buyer took less)
--
-- Anyone on the farm can read orders (a driver needs them to say which order a load fills); the owner, managers
-- and bookkeepers can change them. Optional: nothing is stored until an order is recorded. Idempotent.

create table if not exists orders (
  id               uuid primary key,
  farm_id          uuid not null references farms(id) on delete cascade,
  season_id        uuid not null references seasons(id) on delete cascade,
  sale_id          uuid references sales(id) on delete cascade,
  order_no         text,
  tons             numeric(14,3) not null default 0,
  deliver_from     date,
  deliver_by       date,
  freight_company  text,
  status           text not null default 'open' check (status in ('open', 'closed')),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  deleted_at       timestamptz
);

create index if not exists orders_farm_season_idx on orders (farm_id, season_id);
create index if not exists orders_sale_idx on orders (sale_id);

alter table orders enable row level security;

drop trigger if exists orders_set_updated_at on orders;
create trigger orders_set_updated_at before update on orders
  for each row execute function set_updated_at();

drop policy if exists orders_select on orders;
create policy orders_select on orders for select
  using (app_is_member(farm_id) and deleted_at is null);

drop policy if exists orders_insert on orders;
create policy orders_insert on orders for insert
  with check (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'));

drop policy if exists orders_update on orders;
create policy orders_update on orders for update
  using (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'))
  with check (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'));

grant select, insert, update on orders to authenticated;

-- The order a load was delivered against.
alter table movements
  add column if not exists order_id uuid references orders(id) on delete set null;

-- Deleting an order: the delete function has to know the new table.
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
    'sale_terms', 'sale_documents', 'movements', 'movement_legs',
    'movement_photos', 'invoices', 'overheads', 'payables', 'orders'
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
  if not (app_role(v_farm) in ('owner', 'manager') or v_created = auth.uid()) then
    raise exception 'not allowed';
  end if;

  execute format('update %I set deleted_at = now() where id = $1 and deleted_at is null', p_table) using p_id;
end;
$$;

revoke all on function soft_delete_row(text, uuid) from public;
grant execute on function soft_delete_row(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 20261114130000_recently_deleted.sql
-- ---------------------------------------------------------------------------
-- Recently deleted: see what was deleted lately and bring it back.
--
-- Deleting in the app only stamps deleted_at; the row stays in the database. The ordinary read policies hide
-- stamped rows, so the app cannot list them itself. These two functions do it, applying the same rules as the
-- delete function:
--
--   list_deleted(farm, days)   what was deleted in the last `days` days, with a name and a line of detail
--   restore_row(table, id)     bring one back, with whatever was deleted with it
--
-- Only owners and managers may use them, and only owners may see or restore contracts, invoices and bills,
-- which carry prices and amounts. Nothing is returned beyond a name, a short detail and when it was deleted.
--
-- Restoring a contract brings back its terms, documents and orders; a paddock its agronomy; a load its legs and
-- photo. "With it" means deleted within five minutes of the parent, so something deleted separately, earlier,
-- stays deleted. A load or invoice whose number has since been used by another gets the next free number. Orders
-- cannot be restored while their contract is deleted, and nothing can be restored into a season that was deleted.
--
-- Idempotent: safe to run again.

create or replace function list_deleted(p_farm uuid, p_days integer default 60)
returns table (tbl text, id uuid, deleted_at timestamptz, season text, label text, detail text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_since timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  v_role := app_role(p_farm);
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'not allowed';
  end if;
  v_since := now() - make_interval(days => greatest(1, least(coalesce(p_days, 60), 365)));

  return query
  select 'commodities'::text, t.id, t.deleted_at, (select s.label from seasons s where s.id = t.season_id),
         t.name, null::text
    from commodities t where t.farm_id = p_farm and t.deleted_at >= v_since
  union all
  select 'fields', t.id, t.deleted_at, (select s.label from seasons s where s.id = t.season_id),
         t.name, trim(to_char(t.area_ha, 'FM999999990.##')) || ' ha'
    from fields t where t.farm_id = p_farm and t.deleted_at >= v_since
  union all
  select 'storages', t.id, t.deleted_at, (select s.label from seasons s where s.id = t.season_id),
         t.name, t.kind
    from storages t where t.farm_id = p_farm and t.deleted_at >= v_since
  union all
  select 'movements', t.id, t.deleted_at, (select s.label from seasons s where s.id = t.season_id),
         'Ticket #' || coalesce(t.ticket_no::text, '?'),
         concat_ws(' · ', t.move_date::text, trim(to_char(t.tons, 'FM999999990.##')) || ' t')
    from movements t where t.farm_id = p_farm and t.deleted_at >= v_since
  union all
  select 'orders', t.id, t.deleted_at, (select s.label from seasons s where s.id = t.season_id),
         coalesce('Order #' || nullif(t.order_no, ''), 'Order'),
         trim(to_char(t.tons, 'FM999999990.##')) || ' t'
    from orders t where t.farm_id = p_farm and t.deleted_at >= v_since
  union all
  select 'sales', t.id, t.deleted_at, (select s.label from seasons s where s.id = t.season_id),
         concat_ws(' ', coalesce(nullif(t.buyer, ''), 'Contract'), '#' || nullif(t.contract_no, '')),
         trim(to_char(t.tonnes, 'FM999999990.##')) || ' t'
    from sales t where v_role = 'owner' and t.farm_id = p_farm and t.deleted_at >= v_since
  union all
  select 'invoices', t.id, t.deleted_at, (select s.label from seasons s where s.id = t.season_id),
         'Invoice #' || coalesce(t.invoice_no::text, '?'), t.status
    from invoices t where v_role = 'owner' and t.farm_id = p_farm and t.deleted_at >= v_since
  union all
  select 'payables', t.id, t.deleted_at, (select s.label from seasons s where s.id = t.season_id),
         coalesce(nullif(t.supplier, ''), t.kind), t.kind
    from payables t where v_role = 'owner' and t.farm_id = p_farm and t.deleted_at >= v_since
  order by 3 desc;
end;
$$;

revoke all on function list_deleted(uuid, integer) from public;
grant execute on function list_deleted(uuid, integer) to authenticated;

create or replace function restore_row(p_table text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  j jsonb;
  v_farm uuid;
  v_role text;
  v_deleted timestamptz;
  v_season uuid;
  v_from timestamptz;
  v_to timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if p_table not in ('commodities', 'fields', 'storages', 'movements', 'orders', 'sales', 'invoices', 'payables') then
    raise exception 'cannot restore from %', p_table;
  end if;

  execute format('select to_jsonb(t) from %I t where t.id = $1', p_table) into j using p_id;
  if j is null then
    raise exception 'not found';
  end if;

  v_farm := nullif(j->>'farm_id', '')::uuid;
  v_role := case when v_farm is null then null else app_role(v_farm) end;
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'not allowed';
  end if;
  if p_table in ('sales', 'invoices', 'payables') and v_role <> 'owner' then
    raise exception 'not allowed';
  end if;

  v_deleted := nullif(j->>'deleted_at', '')::timestamptz;
  if v_deleted is null then
    return;                                   -- not deleted: nothing to do
  end if;

  v_season := nullif(j->>'season_id', '')::uuid;
  if v_season is not null and exists (select 1 from seasons s where s.id = v_season and s.deleted_at is not null) then
    raise exception 'It belongs to a season that was deleted';
  end if;
  if p_table = 'orders' and exists (
    select 1 from sales s where s.id = nullif(j->>'sale_id', '')::uuid and s.deleted_at is not null
  ) then
    raise exception 'Restore its contract first';
  end if;

  v_from := v_deleted - interval '5 minutes';
  v_to := v_deleted + interval '5 minutes';

  if p_table = 'movements' then
    begin
      update movements set deleted_at = null where id = p_id;
    exception when unique_violation then
      update movements set deleted_at = null,
        ticket_no = (select coalesce(max(m.ticket_no), 0) + 1 from movements m where m.farm_id = v_farm)
        where id = p_id;
    end;
    update movement_legs set deleted_at = null where movement_id = p_id and deleted_at between v_from and v_to;
    update movement_photos set deleted_at = null where movement_id = p_id and deleted_at between v_from and v_to;
  elsif p_table = 'invoices' then
    begin
      update invoices set deleted_at = null where id = p_id;
    exception when unique_violation then
      update invoices set deleted_at = null,
        invoice_no = (select coalesce(max(i.invoice_no), 0) + 1 from invoices i where i.farm_id = v_farm)
        where id = p_id;
    end;
  elsif p_table = 'sales' then
    update sales set deleted_at = null where id = p_id;
    update sale_terms set deleted_at = null where sale_id = p_id and deleted_at between v_from and v_to;
    update sale_documents set deleted_at = null where sale_id = p_id and deleted_at between v_from and v_to;
    update orders set deleted_at = null where sale_id = p_id and deleted_at between v_from and v_to;
  elsif p_table = 'fields' then
    update fields set deleted_at = null where id = p_id;
    update field_agronomy set deleted_at = null where field_id = p_id and deleted_at between v_from and v_to;
  else
    execute format('update %I set deleted_at = null where id = $1', p_table) using p_id;
  end if;
end;
$$;

revoke all on function restore_row(text, uuid) from public;
grant execute on function restore_row(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 20261114140000_freight_paid_by.sql
-- ---------------------------------------------------------------------------
-- Who pays the freight on a contract: 'we' (the farm pays the carrier, a bill in Payables, nothing on the grain
-- invoice) or 'buyer' (the buyer deducts it from the invoice). Optional: a contract that has never been set is 'we'.
-- Lives in sale_terms with the other money terms, which a field device never receives.
alter table sale_terms
  add column if not exists freight_paid_by text check (freight_paid_by in ('we', 'buyer'));

-- ---------------------------------------------------------------------------
-- 20261114150000_qa_program.sql
-- ---------------------------------------------------------------------------
-- The quality assurance program (and its accreditation number) named on a vendor declaration, kept with the
-- business details so it is typed once. Optional: a farm that has never filled them in has neither.
alter table farms
  add column if not exists qa_program text,
  add column if not exists qa_number text;

-- ---------------------------------------------------------------------------
-- 20261114160000_vendordec_followups.sql
-- ---------------------------------------------------------------------------
-- Follow-ups to the vendor declaration.
--
-- 1. our_ref: the farm's own number for a contract, beside the buyer's contract number (contract_no).
-- 2. sale_documents.kind now allows 'vendor_dec': a declaration that was sent, kept with the contract.
-- 3. user_signatures: a person's handwritten signature, kept as the strokes it was drawn with. It belongs to the
--    person, not the farm: only that person can read or write their own row, and it goes with them to any farm.

alter table sales
  add column if not exists our_ref text;

alter table sale_documents
  drop constraint if exists sale_documents_kind_check;
alter table sale_documents
  add constraint sale_documents_kind_check
  check (kind in ('contract', 'broker_note', 'vendor_dec', 'other'));

create table if not exists user_signatures (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  strokes      text not null,
  signer_name  text,
  updated_at   timestamptz not null default now()
);

alter table user_signatures enable row level security;

drop policy if exists user_signatures_select on user_signatures;
create policy user_signatures_select on user_signatures
  for select to authenticated using (user_id = auth.uid());

drop policy if exists user_signatures_insert on user_signatures;
create policy user_signatures_insert on user_signatures
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists user_signatures_update on user_signatures;
create policy user_signatures_update on user_signatures
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists user_signatures_delete on user_signatures;
create policy user_signatures_delete on user_signatures
  for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 20261114170000_freight_orders.sql
-- ---------------------------------------------------------------------------
-- Freight orders: a job given to a carrier, linked to the buyer's order and contract.
--
-- Capture it once and it flows on: the load names its freight order (movements.freight_order_id), the carrier's bill
-- names it too (payables.freight_order_id), and what is carted but not yet billed shows in Payables. The rate is
-- $/t, or $/t/km with a distance. Rates are money, so only owner, manager and bookkeeper can read or write them.

create table if not exists freight_orders (
  id            uuid primary key,
  farm_id       uuid not null references farms(id) on delete cascade,
  season_id     uuid not null references seasons(id) on delete cascade,
  sale_id       uuid references sales(id) on delete set null,
  order_id      uuid references orders(id) on delete set null,
  freight_no    text,
  carrier       text,
  carrier_email text,
  tons          numeric(14,3) not null default 0,
  rate          numeric(12,4) not null default 0,
  rate_basis    text not null default 'per_t' check (rate_basis in ('per_t', 'per_tkm')),
  distance_km   numeric(10,1),
  pickup        text,
  deliver_to    text,
  load_from     date,
  load_by       date,
  status        text not null default 'open' check (status in ('open', 'closed')),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  deleted_at    timestamptz
);

create index if not exists freight_orders_farm_season_idx on freight_orders (farm_id, season_id);
create index if not exists freight_orders_sale_idx on freight_orders (sale_id);

alter table freight_orders enable row level security;

drop trigger if exists freight_orders_set_updated_at on freight_orders;
create trigger freight_orders_set_updated_at before update on freight_orders
  for each row execute function set_updated_at();

drop policy if exists freight_orders_select on freight_orders;
create policy freight_orders_select on freight_orders for select
  using (app_role(farm_id) in ('owner', 'manager', 'bookkeeper') and deleted_at is null);

drop policy if exists freight_orders_insert on freight_orders;
create policy freight_orders_insert on freight_orders for insert
  with check (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'));

drop policy if exists freight_orders_update on freight_orders;
create policy freight_orders_update on freight_orders for update
  using (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'))
  with check (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'));

grant select, insert, update on freight_orders to authenticated;

-- The freight order a load was carted on, and the one a carrier's bill is for.
alter table movements
  add column if not exists freight_order_id uuid references freight_orders(id) on delete set null;
alter table payables
  add column if not exists freight_order_id uuid references freight_orders(id) on delete set null;

-- A sent freight order is filed with its contract.
alter table sale_documents
  drop constraint if exists sale_documents_kind_check;
alter table sale_documents
  add constraint sale_documents_kind_check
  check (kind in ('contract', 'broker_note', 'vendor_dec', 'freight_order', 'other'));

-- Deleting a freight order: the delete function has to know the new table.
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
    'sale_terms', 'sale_documents', 'movements', 'movement_legs',
    'movement_photos', 'invoices', 'overheads', 'payables', 'orders', 'freight_orders'
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
  if not (app_role(v_farm) in ('owner', 'manager') or v_created = auth.uid()) then
    raise exception 'not allowed';
  end if;

  execute format('update %I set deleted_at = now() where id = $1 and deleted_at is null', p_table) using p_id;
end;
$$;

revoke all on function soft_delete_row(text, uuid) from public;
grant execute on function soft_delete_row(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 20261114180000_outload_end.sql
-- ---------------------------------------------------------------------------
-- Which end of a bunker is emptied first (see paste-into-sql-editor.sql).
-- Which end of a bunker is emptied first: 'last' (last in, first out; the default) or 'first' (first in, first out,
-- from the back, for a bunker that can be opened at both ends). Optional: stored only once it has been set.
alter table storages
  add column if not exists outload_end text;
alter table storages
  drop constraint if exists storages_outload_end_check;
alter table storages
  add constraint storages_outload_end_check check (outload_end is null or outload_end in ('last', 'first'));

-- ---------------------------------------------------------------------------
-- 20261114190000_record_documents.sql
-- ---------------------------------------------------------------------------
-- Attach files to orders, invoices (receivables) and bills (payables).
--
-- One table for all three, so a buyer's order, a copy of an invoice, a remittance or a supplier's bill can sit beside
-- the record it belongs to. The files live in the same private 'sale-documents' bucket as contracts (farm_id leading
-- the path), so the existing storage policies already cover them.
--
-- Who can see a document follows the record it is attached to. Orders, invoices and bills are all visible to the owner,
-- the manager and the bookkeeper (see 20261114200000_manager_sees_money.sql); drivers and farm workers see none.

create table if not exists record_documents (
  id            uuid primary key,
  farm_id       uuid not null references farms(id) on delete cascade,
  parent_type   text not null check (parent_type in ('order', 'invoice', 'payable')),
  parent_id     uuid not null,
  kind          text not null default 'other'
                check (kind in ('order', 'invoice', 'remittance', 'bill', 'proof_of_delivery', 'receipt', 'other')),
  file_name     text,
  storage_path  text not null,
  byte_size     integer,
  uploaded_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  updated_by    uuid,
  deleted_at    timestamptz
);

create index if not exists record_documents_parent_idx on record_documents (farm_id, parent_type, parent_id);

alter table record_documents enable row level security;

drop trigger if exists record_documents_set_updated_at on record_documents;
create trigger record_documents_set_updated_at before update on record_documents
  for each row execute function set_updated_at();

drop policy if exists record_documents_select on record_documents;
create policy record_documents_select on record_documents for select
  using (deleted_at is null and app_role(farm_id) in ('owner', 'manager', 'bookkeeper'));

drop policy if exists record_documents_insert on record_documents;
create policy record_documents_insert on record_documents for insert
  with check (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'));

drop policy if exists record_documents_update on record_documents;
create policy record_documents_update on record_documents for update
  using (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'))
  with check (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'));

grant select, insert, update on record_documents to authenticated;

-- Deleting a document: the delete function has to know the new table, and a bookkeeper (who may attach and remove
-- documents) is allowed to remove one of the two document tables' rows even though they did not create it.
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
    'movement_photos', 'invoices', 'overheads', 'payables', 'orders', 'freight_orders'
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

-- ---------------------------------------------------------------------------
-- 20261114200000_manager_sees_money.sql
-- ---------------------------------------------------------------------------
-- Managers see the money side too: invoices (receivables) and bills (payables).
--
-- Until now both were owner and bookkeeper only. A manager runs the farm day to day and needs to see what is owed to
-- and by it, so they join the owner and the bookkeeper on both tables. Drivers and farm workers still see neither.

drop policy if exists invoices_select on invoices;
create policy invoices_select on invoices for select
  using (app_role(farm_id) in ('owner', 'manager', 'bookkeeper') and deleted_at is null);

drop policy if exists invoices_insert on invoices;
create policy invoices_insert on invoices for insert
  with check (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'));

drop policy if exists invoices_update on invoices;
create policy invoices_update on invoices for update
  using (app_role(farm_id) in ('owner', 'manager', 'bookkeeper')
         and app_may_manage_row(farm_id, created_by))
  with check (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'));

drop policy if exists payables_select on payables;
create policy payables_select on payables for select
  using (app_role(farm_id) in ('owner', 'manager', 'bookkeeper') and deleted_at is null);

drop policy if exists payables_insert on payables;
create policy payables_insert on payables for insert
  with check (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'));

drop policy if exists payables_update on payables;
create policy payables_update on payables for update
  using (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'))
  with check (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'));

-- ---------------------------------------------------------------------------
-- 20261114210000_wall_height.sql
-- ---------------------------------------------------------------------------
-- Bunkers and sheds can have walls. The wall height (metres) goes into the capacity and tarp calculations: the grain is
-- held straight up to the top of the walls, with the peaked pile on top. Blank means no walls.
alter table storages
  add column if not exists wall_height_m numeric(6,2);
alter table storages
  drop constraint if exists storages_wall_height_check;
alter table storages
  add constraint storages_wall_height_check check (wall_height_m is null or wall_height_m >= 0);

-- ---------------------------------------------------------------------------
-- 20261114220000_pic.sql
-- ---------------------------------------------------------------------------
-- The property identification code (PIC) named on the national vendor declaration, kept with the business details.
alter table farms
  add column if not exists pic text;

-- ---------------------------------------------------------------------------
-- 20261114230000_freight_flat_plus_km.sql
-- ---------------------------------------------------------------------------
-- Freight orders can be a flat $/t plus so much per tonne per km (eg $15/t + $0.10/t/km x 300 km = $45/t).
-- flat_rate is the flat $/t; rate stays the per-km rate. Optional: only freight orders on that basis have a flat rate.
alter table freight_orders
  add column if not exists flat_rate numeric(12,4);
alter table freight_orders
  drop constraint if exists freight_orders_rate_basis_check;
alter table freight_orders
  add constraint freight_orders_rate_basis_check check (rate_basis in ('per_t', 'per_tkm', 'flat_tkm'));

-- ---------------------------------------------------------------------------
-- 20261114240000_sale_paid.sql
-- ---------------------------------------------------------------------------
-- A contract that has been paid in full and is finished with: hidden from the main list and the pick lists, still kept.
-- Optional: a contract never marked has no value.
alter table sales
  add column if not exists is_paid boolean;

-- ---------------------------------------------------------------------------
-- 20261114250000_field_boundary.sql
-- ---------------------------------------------------------------------------
-- A paddock's outline on the farm map: rings of [longitude, latitude] points, from a shapefile import.
-- Optional: a paddock never mapped has none.
alter table fields
  add column if not exists boundary jsonb;

-- ---------------------------------------------------------------------------
-- 20261114260000_input_stock.sql
-- ---------------------------------------------------------------------------
-- Inputs and stock: seed, fertiliser, fuel and chemical bought for the farm, and what is used.
--
-- One row per entry: a delivery (buy), something used (use), or a correction from a stock take (adjust, signed).
-- What is on hand is the sum of them per product, across every season, worked out in the app. Prices are money, so
-- only owner, manager and bookkeeper can read or write them, the same as freight orders.

create table if not exists input_stock (
  id          uuid primary key,
  farm_id     uuid not null references farms(id) on delete cascade,
  season_id   uuid not null references seasons(id) on delete cascade,
  kind        text not null check (kind in ('seed', 'fert', 'fuel', 'chem')),
  product     text not null,
  unit        text not null default 't' check (unit in ('t', 'kg', 'L')),
  move_type   text not null default 'buy' check (move_type in ('buy', 'use', 'adjust')),
  qty         numeric(14,3) not null default 0,
  unit_cost   numeric(12,4),
  move_date   date,
  supplier    text,
  reference   text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_by  uuid,
  deleted_at  timestamptz
);

create index if not exists input_stock_farm_season_idx on input_stock (farm_id, season_id);

alter table input_stock enable row level security;

drop trigger if exists input_stock_set_updated_at on input_stock;
create trigger input_stock_set_updated_at before update on input_stock
  for each row execute function set_updated_at();

drop policy if exists input_stock_select on input_stock;
create policy input_stock_select on input_stock for select
  using (app_role(farm_id) in ('owner', 'manager', 'bookkeeper') and deleted_at is null);

drop policy if exists input_stock_insert on input_stock;
create policy input_stock_insert on input_stock for insert
  with check (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'));

drop policy if exists input_stock_update on input_stock;
create policy input_stock_update on input_stock for update
  using (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'))
  with check (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'));

grant select, insert, update on input_stock to authenticated;

-- Deleting an entry: the delete function has to know the new table.
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
    'movement_photos', 'invoices', 'overheads', 'payables', 'orders', 'freight_orders', 'input_stock'
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

-- ---------------------------------------------------------------------------
-- 20261114270000_input_location.sql
-- ---------------------------------------------------------------------------
-- Where an input is kept: the name of the silo, shed or other storage it was put into or taken from.
-- A name rather than a link, so the stock stays in the same place when a new season gives every storage a new id.
-- Optional: an entry with no place recorded is simply stock with no location.
alter table input_stock
  add column if not exists location text;

-- ---------------------------------------------------------------------------
-- 20261114280000_field_property.sql
-- ---------------------------------------------------------------------------
-- Which farm (property) a paddock belongs to, so the farm map can label each farm and show or hide them.
-- Plain text, filled in from the shapefile's farm name or typed on the paddock. Optional.
alter table fields
  add column if not exists property text;

-- ---------------------------------------------------------------------------
-- 20261115100000_spray_jobs.sql
-- ---------------------------------------------------------------------------
-- Spray requests: a job for a spray contractor, with the paddocks to be sprayed, sent as a PDF.
--
-- The scalar columns are what lists and filters need; everything else on the form (the product rates, the checklist
-- answers, the neighbours, the paddocks chosen) is one json document, so a new box on a contractor's form never needs
-- a new column. No prices on a spray request: owner and manager only, like the rest of the farm's paperwork.

create table if not exists spray_jobs (
  id               uuid primary key,
  farm_id          uuid not null references farms(id) on delete cascade,
  season_id        uuid not null references seasons(id) on delete cascade,
  job_no           text,
  contractor       text,
  contractor_email text,
  form             text not null default 'standard' check (form in ('standard', 'aircair')),
  date_required    date,
  status           text not null default 'draft' check (status in ('draft', 'sent', 'done')),
  body             jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  updated_by       uuid,
  deleted_at       timestamptz
);

create index if not exists spray_jobs_farm_season_idx on spray_jobs (farm_id, season_id);

alter table spray_jobs enable row level security;

drop trigger if exists spray_jobs_set_updated_at on spray_jobs;
create trigger spray_jobs_set_updated_at before update on spray_jobs
  for each row execute function set_updated_at();

drop policy if exists spray_jobs_select on spray_jobs;
create policy spray_jobs_select on spray_jobs for select
  using (app_role(farm_id) in ('owner', 'manager') and deleted_at is null);

drop policy if exists spray_jobs_insert on spray_jobs;
create policy spray_jobs_insert on spray_jobs for insert
  with check (app_role(farm_id) in ('owner', 'manager'));

drop policy if exists spray_jobs_update on spray_jobs;
create policy spray_jobs_update on spray_jobs for update
  using (app_role(farm_id) in ('owner', 'manager'))
  with check (app_role(farm_id) in ('owner', 'manager'));

grant select, insert, update on spray_jobs to authenticated;

-- Deleting a spray request: the delete function has to know the new table.
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

-- ---------------------------------------------------------------------------
-- 20261115110000_load_time.sql
-- ---------------------------------------------------------------------------
-- The time a load was loaded or left, as 24 hour text such as 14:30 (optional; stored only when a time is recorded).
-- Used by the load report. Safe to run more than once.
alter table movements
  add column if not exists load_time text;

-- ---------------------------------------------------------------------------
-- 20261115120000_barley_retention.sql
-- ---------------------------------------------------------------------------
-- Barley retention: the percentage of a sample kept above the 2.5 mm screen, on a load and on a silo
-- (optional; stored only when a retention figure is recorded). Safe to run more than once.
alter table movements
  add column if not exists retention_pct numeric(6,2);
alter table storages
  add column if not exists retention_pct numeric(6,2);

-- ---------------------------------------------------------------------------
-- 20261115130000_load_destination.sql
-- ---------------------------------------------------------------------------
-- Where a load is going, typed on the load (optional; stored only when something is typed). It is shown on the load
-- report and the load ticket, in place of the contract's own delivery site. Safe to run more than once.
alter table movements
  add column if not exists load_destination text;

-- ---------------------------------------------------------------------------
-- 20261115140000_show_aircair.sql
-- ---------------------------------------------------------------------------
-- Whether Aircair's own form is offered on a spray request (optional; stored only once it has been switched on).
-- Safe to run more than once.
alter table farms
  add column if not exists show_aircair boolean;

-- ---------------------------------------------------------------------------
-- 20261116100000_address_parts.sql
-- ---------------------------------------------------------------------------
-- An address in its parts: line 1, line 2, town, state and postcode (optional; stored only once an address has been split).
-- The joined one-line address stays in its old column, which is what the documents print. Safe to run more than once.
alter table farms
  add column if not exists address_parts jsonb;

alter table sale_terms
  add column if not exists buyer_address_parts jsonb;

-- ---------------------------------------------------------------------------
-- 20261116140000_delivery_pattern.sql
-- ---------------------------------------------------------------------------
-- How a contract is delivered: 'call' (the buyer orders it), 'sellers' (the seller chooses when) or 'even' (spread evenly over the window).
-- Optional; stored only once it has been set. Safe to run more than once.
alter table sales
  add column if not exists delivery_pattern text;

