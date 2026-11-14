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
