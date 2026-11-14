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
