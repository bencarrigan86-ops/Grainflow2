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
