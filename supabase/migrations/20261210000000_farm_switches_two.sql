-- More switches an owner can turn on, and a read-only Advisor role. Safe to run more than once. Run after 20261209000000_farm_switches.sql.
--
-- Same promise as the first set: every switch is off until the owner turns it on, a farm with every switch off follows the
-- standard rules, and the policies here sit beside the existing ones without changing them. A permissive policy ADDS access
-- (policies are joined with OR); a restrictive policy TAKES AWAY access (policies are joined with AND). To go back to the
-- standard rules for good, drop the policies named here (and the Advisor role stays unused).
--
-- Switches (the key is what is saved in farms.switches):
--   workersRaiseSprays         a farm worker can write spray requests (drafts, for a manager to send)
--   deleteOwnerManagerOnly     only an owner or manager can delete a load or a contract
--   finalWeightsManagersOnly   only an owner or manager can mark a weight final
--   bookkeeperEditsLoads       a bookkeeper can add and change loads, not only read them
--   advisorSeesLoads           an advisor reads the loads and contracts (tonnes, no prices)
--   advisorSeesPrices          an advisor also reads contract prices, invoices and bills
--   advisorSeesOverheads       an advisor also reads the whole-farm overheads

-- ---------------------------------------------------------------------------
-- The Advisor role: a person who looks and writes nothing (an agronomist, an accountant, a bank). A membership or an invitation
-- may now be for an advisor.
-- ---------------------------------------------------------------------------
alter table farm_users drop constraint if exists farm_users_role_check;
alter table farm_users add constraint farm_users_role_check
  check (role in ('owner', 'manager', 'bookkeeper', 'farm_worker', 'driver', 'support', 'advisor'));

alter table invitations drop constraint if exists invitations_role_check;
alter table invitations add constraint invitations_role_check
  check (role in ('owner', 'manager', 'bookkeeper', 'farm_worker', 'driver', 'advisor'));

-- What an advisor always reads: paddocks, production, inputs used, spray requests. Nothing with a price on it.
-- (Seasons, commodities, paddocks and storage already read as "any member"; these are the tables that name roles.)
drop policy if exists field_agronomy_advisor_read on field_agronomy;
create policy field_agronomy_advisor_read on field_agronomy for select
  using (app_role(farm_id) = 'advisor' and deleted_at is null);

drop policy if exists input_stock_advisor_read on input_stock;
create policy input_stock_advisor_read on input_stock for select
  using (app_role(farm_id) = 'advisor' and move_type in ('use', 'adjust') and deleted_at is null);

drop policy if exists spray_jobs_advisor_read on spray_jobs;
create policy spray_jobs_advisor_read on spray_jobs for select
  using (app_role(farm_id) = 'advisor' and deleted_at is null);

-- advisorSeesLoads: the loads, their legs and photos, and the contracts (without the price: that is sale_terms)
drop policy if exists movements_advisor_loads on movements;
create policy movements_advisor_loads on movements as restrictive for select
  using (app_role(farm_id) is distinct from 'advisor' or app_switch(farm_id, 'advisorSeesLoads'));

drop policy if exists movement_legs_advisor_loads on movement_legs;
create policy movement_legs_advisor_loads on movement_legs as restrictive for select
  using (app_role(farm_id) is distinct from 'advisor' or app_switch(farm_id, 'advisorSeesLoads'));

drop policy if exists movement_photos_advisor_loads on movement_photos;
create policy movement_photos_advisor_loads on movement_photos as restrictive for select
  using (app_role(farm_id) is distinct from 'advisor' or app_switch(farm_id, 'advisorSeesLoads'));

drop policy if exists sales_advisor_loads on sales;
create policy sales_advisor_loads on sales as restrictive for select
  using (app_role(farm_id) is distinct from 'advisor' or app_switch(farm_id, 'advisorSeesLoads'));

-- advisorSeesPrices: contract prices, invoices, bills, orders and the paperwork on contracts
drop policy if exists orders_advisor_prices on orders;
create policy orders_advisor_prices on orders as restrictive for select
  using (app_role(farm_id) is distinct from 'advisor' or app_switch(farm_id, 'advisorSeesPrices'));

drop policy if exists sale_terms_advisor_read on sale_terms;
create policy sale_terms_advisor_read on sale_terms for select
  using (app_role(farm_id) = 'advisor' and app_switch(farm_id, 'advisorSeesLoads') and app_switch(farm_id, 'advisorSeesPrices') and deleted_at is null);

drop policy if exists invoices_advisor_read on invoices;
create policy invoices_advisor_read on invoices for select
  using (app_role(farm_id) = 'advisor' and app_switch(farm_id, 'advisorSeesPrices') and deleted_at is null);

drop policy if exists payables_advisor_read on payables;
create policy payables_advisor_read on payables for select
  using (app_role(farm_id) = 'advisor' and app_switch(farm_id, 'advisorSeesPrices') and deleted_at is null);

drop policy if exists freight_orders_advisor_read on freight_orders;
create policy freight_orders_advisor_read on freight_orders for select
  using (app_role(farm_id) = 'advisor' and app_switch(farm_id, 'advisorSeesPrices') and deleted_at is null);

drop policy if exists sale_documents_advisor_read on sale_documents;
create policy sale_documents_advisor_read on sale_documents for select
  using (app_role(farm_id) = 'advisor' and app_switch(farm_id, 'advisorSeesPrices') and deleted_at is null);

-- advisorSeesOverheads
drop policy if exists overheads_advisor_read on overheads;
create policy overheads_advisor_read on overheads for select
  using (app_role(farm_id) = 'advisor' and app_switch(farm_id, 'advisorSeesOverheads') and deleted_at is null);

-- ---------------------------------------------------------------------------
-- workersRaiseSprays: a worker reads the farm's spray requests, writes new ones, and changes drafts. Once a request is sent
-- (or done) it is out of their hands: sending one to the contractor stays with an owner or manager.
-- ---------------------------------------------------------------------------
drop policy if exists spray_jobs_worker_read on spray_jobs;
create policy spray_jobs_worker_read on spray_jobs for select
  using (app_role(farm_id) = 'farm_worker' and app_switch(farm_id, 'workersRaiseSprays') and deleted_at is null);

drop policy if exists spray_jobs_worker_insert on spray_jobs;
create policy spray_jobs_worker_insert on spray_jobs for insert
  with check (app_role(farm_id) = 'farm_worker' and app_switch(farm_id, 'workersRaiseSprays') and status = 'draft');

drop policy if exists spray_jobs_worker_update on spray_jobs;
create policy spray_jobs_worker_update on spray_jobs for update
  using (app_role(farm_id) = 'farm_worker' and app_switch(farm_id, 'workersRaiseSprays') and status = 'draft')
  with check (app_role(farm_id) = 'farm_worker' and app_switch(farm_id, 'workersRaiseSprays') and status = 'draft');

-- ---------------------------------------------------------------------------
-- bookkeeperEditsLoads: a bookkeeper adds and changes loads (and their legs), whether open or closed, but does not remove them.
-- ---------------------------------------------------------------------------
drop policy if exists movements_bookkeeper_insert on movements;
create policy movements_bookkeeper_insert on movements for insert
  with check (app_role(farm_id) = 'bookkeeper' and app_switch(farm_id, 'bookkeeperEditsLoads'));

drop policy if exists movements_bookkeeper_update on movements;
create policy movements_bookkeeper_update on movements for update
  using (app_role(farm_id) = 'bookkeeper' and app_switch(farm_id, 'bookkeeperEditsLoads'))
  with check (app_role(farm_id) = 'bookkeeper' and app_switch(farm_id, 'bookkeeperEditsLoads') and deleted_at is null);

drop policy if exists movement_legs_bookkeeper_insert on movement_legs;
create policy movement_legs_bookkeeper_insert on movement_legs for insert
  with check (app_role(farm_id) = 'bookkeeper' and app_switch(farm_id, 'bookkeeperEditsLoads'));

drop policy if exists movement_legs_bookkeeper_update on movement_legs;
create policy movement_legs_bookkeeper_update on movement_legs for update
  using (app_role(farm_id) = 'bookkeeper' and app_switch(farm_id, 'bookkeeperEditsLoads'))
  with check (app_role(farm_id) = 'bookkeeper' and app_switch(farm_id, 'bookkeeperEditsLoads'));

-- ---------------------------------------------------------------------------
-- deleteOwnerManagerOnly: with it on, only an owner or manager can mark a load, a contract or its terms as deleted. Anyone else
-- keeps the rest of what they could do. (Restoring from Recently deleted is not a delete and is not held back.)
-- ---------------------------------------------------------------------------
create or replace function app_may_delete(p_farm uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app_role(p_farm) in ('owner', 'manager') or not app_switch(p_farm, 'deleteOwnerManagerOnly')
$$;

drop policy if exists movements_delete_switch on movements;
create policy movements_delete_switch on movements as restrictive for update
  using (true)
  with check (deleted_at is null or app_may_delete(farm_id));

drop policy if exists sales_delete_switch on sales;
create policy sales_delete_switch on sales as restrictive for update
  using (true)
  with check (deleted_at is null or app_may_delete(farm_id));

drop policy if exists sale_terms_delete_switch on sale_terms;
create policy sale_terms_delete_switch on sale_terms as restrictive for update
  using (true)
  with check (deleted_at is null or app_may_delete(farm_id));

-- The delete function checks the same thing (it runs with its owner's rights, so the policies above do not reach it).
-- Same function as 20261118300000_season_delete_owner_only.sql with one added rule.
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

  -- a farm that has asked for it: loads and contracts are removed by an owner or manager only
  if p_table in ('movements', 'sales', 'sale_terms') and not app_may_delete(v_farm) then
    raise exception 'only the owner or a manager can delete this';
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

-- ---------------------------------------------------------------------------
-- finalWeightsManagersOnly: with it on, a load can only be saved as "final" weight by an owner or manager, and a final load is
-- theirs to change.
-- ---------------------------------------------------------------------------
create or replace function app_may_finalise(p_farm uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app_role(p_farm) in ('owner', 'manager') or not app_switch(p_farm, 'finalWeightsManagersOnly')
$$;

drop policy if exists movements_final_weight_insert on movements;
create policy movements_final_weight_insert on movements as restrictive for insert
  with check (weight_status <> 'final' or app_may_finalise(farm_id));

drop policy if exists movements_final_weight_update on movements;
create policy movements_final_weight_update on movements as restrictive for update
  using (true)
  with check (weight_status <> 'final' or app_may_finalise(farm_id));

notify pgrst, 'reload schema';
