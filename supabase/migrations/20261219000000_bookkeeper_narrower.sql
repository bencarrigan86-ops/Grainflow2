-- A bookkeeper does the money side: contracts and prices, invoices, bills. Three things they were sent that they do not need:
--
--   overheads     the whole farm's costs and so its profit: owner only (a manager or an advisor can still be given them by the
--                 farm's own switches, which are separate policies and are not touched here)
--   grain orders  who is to deliver what, and when: owner and manager (a driver and a worker still read them, as before)
--   input stock   seed, fertiliser, fuel and chemical on hand: a bookkeeper reads it but no longer adds or changes entries
--
-- Idempotent: safe to run again.

-- overheads: owner only
drop policy if exists overheads_select on overheads;
create policy overheads_select on overheads for select
  using (app_role(farm_id) = 'owner' and deleted_at is null);

drop policy if exists overheads_insert on overheads;
create policy overheads_insert on overheads for insert
  with check (app_role(farm_id) = 'owner');

drop policy if exists overheads_update on overheads;
create policy overheads_update on overheads for update
  using (app_role(farm_id) = 'owner')
  with check (app_role(farm_id) = 'owner');

-- grain orders: not sent to a bookkeeper, and changed by an owner or manager only
drop policy if exists orders_select on orders;
create policy orders_select on orders for select
  using (app_role(farm_id) in ('owner', 'manager', 'farm_worker', 'driver', 'advisor', 'support') and deleted_at is null);

drop policy if exists orders_insert on orders;
create policy orders_insert on orders for insert
  with check (app_role(farm_id) in ('owner', 'manager'));

drop policy if exists orders_update on orders;
create policy orders_update on orders for update
  using (app_role(farm_id) in ('owner', 'manager'))
  with check (app_role(farm_id) in ('owner', 'manager'));

-- input stock: a bookkeeper still reads it; only an owner, a manager or (use and count) a worker writes it
drop policy if exists input_stock_insert on input_stock;
create policy input_stock_insert on input_stock for insert
  with check (app_role(farm_id) in ('owner', 'manager')
              or (app_role(farm_id) = 'farm_worker' and move_type in ('use', 'adjust') and unit_cost is null));

drop policy if exists input_stock_update on input_stock;
create policy input_stock_update on input_stock for update
  using (app_role(farm_id) in ('owner', 'manager')
         or (app_role(farm_id) = 'farm_worker' and move_type in ('use', 'adjust')))
  with check (app_role(farm_id) in ('owner', 'manager')
              or (app_role(farm_id) = 'farm_worker' and move_type in ('use', 'adjust') and unit_cost is null));

notify pgrst, 'reload schema';
