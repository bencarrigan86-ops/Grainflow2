-- Paste ALL of this into the Supabase SQL editor and press Run. Safe to run more than once.

-- A farm's own grades for each commodity (optional; stored only when some have been added)
alter table commodities
  add column if not exists custom_grades jsonb;

-- The grades a contract lists, each with a $/t premium or discount (optional; stored only when grades are listed)
alter table sale_terms
  add column if not exists grade_options jsonb;

-- Canola oil: the oil % of a load or a silo, and a contract's base oil and % of price per 1% of oil
-- (optional; stored only when oil is recorded or a contract is priced for it)
alter table movements
  add column if not exists oil_pct numeric(6,2);
alter table storages
  add column if not exists oil_pct numeric(6,2);
alter table sale_terms
  add column if not exists oil_base_pct numeric(6,2),
  add column if not exists oil_adjust_pct numeric(6,2);

-- Off-farm storage: grain held by a third party, with who runs it and what it held at the start of the
-- season by commodity and grade (optional; stored only on a location that is off-farm)
alter table storages
  add column if not exists off_farm jsonb;

-- The receiving site's own ticket number on a load (optional; stored only when one is recorded)
alter table movements
  add column if not exists external_ticket_no text;

-- Barley retention: the percentage kept above the 2.5 mm screen, on a load and on a silo
-- (optional; stored only when a retention figure is recorded)
alter table movements
  add column if not exists retention_pct numeric(6,2);
alter table storages
  add column if not exists retention_pct numeric(6,2);

-- Where a load is going, typed on the load (optional; stored only when something is typed)
alter table movements
  add column if not exists load_destination text;

-- Whether Aircair's own form is offered on a spray request (optional; stored only once it has been switched on)
alter table farms
  add column if not exists show_aircair boolean;

-- An address in its parts: line 1, line 2, town, state and postcode (optional; stored only once an address has been split)
alter table farms
  add column if not exists address_parts jsonb;
alter table sale_terms
  add column if not exists buyer_address_parts jsonb;

-- How a contract is delivered: 'call' (the buyer orders it), 'sellers' (the seller chooses when) or 'even' (spread evenly over the window) (optional; stored only once it has been set)
alter table sales
  add column if not exists delivery_pattern text;

-- The time a load was loaded or left, as 24 hour text such as 14:30 (optional; stored only when a time is recorded)
alter table movements
  add column if not exists load_time text;

-- Accounts payable: bills owed (brokerage, freight, storage, other), and a contract's brokerage $/t.
-- This creates a table, so it is longer than the others; it is safe to run more than once.
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

-- Harvest finished: whether all of a paddock is in (optional; stored only once it is set)
alter table fields
  add column if not exists harvest_done boolean;

-- Hectares still to harvest on a part-harvested paddock (optional; stored only once it is set)
alter table fields
  add column if not exists harvest_ha_left numeric;

-- Orders: a buyer asks for grain against a contract (see migrations/20261114120000_orders.sql)
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

-- Recently deleted: list and restore (see migrations/20261114130000_recently_deleted.sql)
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

-- Who pays the freight on a contract: "we" (a bill in Payables, nothing on the grain invoice) or "buyer"
-- (deducted from the invoice). Optional: a contract never set is "we".
alter table sale_terms
  add column if not exists freight_paid_by text check (freight_paid_by in ('we', 'buyer'));

-- The quality assurance program (and its accreditation number) named on a vendor declaration, typed once.
alter table farms
  add column if not exists qa_program text,
  add column if not exists qa_number text;

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

-- Freight orders (see migrations/20261114170000_freight_orders.sql)
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

-- Which end of a bunker is emptied first: 'last' (last in, first out; the default) or 'first' (first in, first out,
-- from the back, for a bunker that can be opened at both ends). Optional: stored only once it has been set.
alter table storages
  add column if not exists outload_end text;
alter table storages
  drop constraint if exists storages_outload_end_check;
alter table storages
  add constraint storages_outload_end_check check (outload_end is null or outload_end in ('last', 'first'));

-- ==== record_documents (build 238) ====
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

-- ==== managers see invoices and bills (build 238) ====
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

-- ==== bunker and shed wall height (build 238) ====
-- Bunkers and sheds can have walls. The wall height (metres) goes into the capacity and tarp calculations: the grain is
-- held straight up to the top of the walls, with the peaked pile on top. Blank means no walls.
alter table storages
  add column if not exists wall_height_m numeric(6,2);
alter table storages
  drop constraint if exists storages_wall_height_check;
alter table storages
  add constraint storages_wall_height_check check (wall_height_m is null or wall_height_m >= 0);

-- ==== property identification code (build 240) ====
-- The property identification code (PIC) named on the national vendor declaration, kept with the business details.
alter table farms
  add column if not exists pic text;

-- ==== freight: flat rate plus per km (build 240) ====
-- Freight orders can be a flat $/t plus so much per tonne per km (eg $15/t + $0.10/t/km x 300 km = $45/t).
-- flat_rate is the flat $/t; rate stays the per-km rate. Optional: only freight orders on that basis have a flat rate.
alter table freight_orders
  add column if not exists flat_rate numeric(12,4);
alter table freight_orders
  drop constraint if exists freight_orders_rate_basis_check;
alter table freight_orders
  add constraint freight_orders_rate_basis_check check (rate_basis in ('per_t', 'per_tkm', 'flat_tkm'));

-- ==== contracts marked paid (build 242) ====
-- A contract that has been paid in full and is finished with: hidden from the main list and the pick lists, still kept.
-- Optional: a contract never marked has no value.
alter table sales
  add column if not exists is_paid boolean;

-- ==== paddock outlines for the farm map (build 243) ====
-- A paddock's outline on the farm map: rings of [longitude, latitude] points, from a shapefile import.
-- Optional: a paddock never mapped has none.
alter table fields
  add column if not exists boundary jsonb;

-- ==== inputs and stock: seed, fertiliser, fuel, chemical (build 244) ====
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

-- ==== where inputs are kept (build 246) ====
-- Where an input is kept: the name of the silo, shed or other storage it was put into or taken from.
-- A name rather than a link, so the stock stays in the same place when a new season gives every storage a new id.
-- Optional: an entry with no place recorded is simply stock with no location.
alter table input_stock
  add column if not exists location text;

-- ==== which farm a paddock is on (build 247) ====
-- Which farm (property) a paddock belongs to, so the farm map can label each farm and show or hide them.
-- Plain text, filled in from the shapefile's farm name or typed on the paddock. Optional.
alter table fields
  add column if not exists property text;

-- ==== spray requests (build 248) ====
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

-- ==== bank details to owner and bookkeeper only; workers see stock without prices (build 276) ====
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

-- ==== support tools: read-only support access, report a problem (build 277) ====
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


-- ---------------------------------------------------------------------------
-- ONE LAST STEP, done once by whoever runs the app's support. It is not part of this file because it names a
-- person. Run this on its own, with the email you sign in to Grainflow with:
--
--   insert into support_settings (user_id) select id from auth.users where email = 'you@example.com'
--   on conflict do nothing;
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- Build 284: a third yield mode, "recorded", for past seasons imported from your own records
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
-- Build 293: withdrawing an invitation, which the server was refusing
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
-- Build 294: deleting a season is the owner only, on the server too
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

-- Build 301: canola free fatty acid (FFA) on loads and silos (optional column)
alter table movements
  add column if not exists ffa_pct numeric(6,2);
alter table storages
  add column if not exists ffa_pct numeric(6,2);

notify pgrst, 'reload schema';

-- Build 307: the order the commodities are listed in (optional column)
alter table farms
  add column if not exists commodity_order jsonb;

notify pgrst, 'reload schema';

-- Build 308: outload numbers, each person's series digit, and the farm's saved delivery-file layouts
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



-- ===========================================================================
-- Build 311: trial invites
-- ===========================================================================
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
drop function if exists trial_invites_list();
create function trial_invites_list()
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
drop function if exists support_farms();
create function support_farms()
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


-- ===========================================================================
-- Build 313: a trial owner starts their own farm
-- ===========================================================================
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

-- Build 317: a storage can be given a volume in cubic metres. The most it holds is that volume times the test weight of what is in
-- it (the commodity's, or the one set on the storage), worked out in the app. Blank means the tonnes typed on it are used, as before.
alter table storages
  add column if not exists volume_m3 numeric(12,2);
alter table storages
  drop constraint if exists storages_volume_check;
alter table storages
  add constraint storages_volume_check check (volume_m3 is null or volume_m3 >= 0);

notify pgrst, 'reload schema';

-- Build 318: which part of the year a commodity is harvested in (winter or summer), so harvest progress can be read for each. Blank means
-- automatic: the app goes by the commodity's name.
alter table commodities
  add column if not exists harvest_season text;
alter table commodities
  drop constraint if exists commodities_harvest_season_check;
alter table commodities
  add constraint commodities_harvest_season_check check (harvest_season is null or harvest_season in ('winter', 'summer'));

notify pgrst, 'reload schema';

-- Build 320: the yield expected from the hectares still to harvest on a part-harvested paddock, when it differs from the paddock's own
-- yield estimate. Blank means the paddock's estimate.
alter table fields
  add column if not exists harvest_left_yield numeric;

notify pgrst, 'reload schema';

-- The farm's logo: a small JPEG kept as text, printed in the header of the PDFs (optional; stored only once a logo has been added)
alter table farms
  add column if not exists logo text;

-- The people who sign for the business: their names, one to a line, offered as the printed name on documents (optional)
alter table farms
  add column if not exists signers text;

-- Whether the logo is switched off (it is printed whenever there is one, unless this is true) (optional)
alter table farms
  add column if not exists logo_off boolean;

notify pgrst, 'reload schema';

-- Who invoices on a contract: 'seller' (the farm invoices the buyer) or 'rcti' (the buyer issues a recipient created tax invoice) (optional)
alter table sales
  add column if not exists invoicing text;

notify pgrst, 'reload schema';

-- A freight order's Deliver from and Deliver to addresses in parts, beside the one line each already has (optional)
alter table freight_orders
  add column if not exists pickup_parts jsonb;
alter table freight_orders
  add column if not exists deliver_to_parts jsonb;

notify pgrst, 'reload schema';

-- Buyer order number on freight orders
alter table freight_orders
  add column if not exists buyer_order_no text;

notify pgrst, 'reload schema';
