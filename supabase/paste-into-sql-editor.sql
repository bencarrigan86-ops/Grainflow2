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
