-- Test database, part 4 of 4: 20261210000000_farm_switches_two.sql to 20261221000000_access_raise.sql.
-- Paste ALL of this into the Supabase SQL editor of the TEST project and press Run. Run the parts in order.

-- ---------------------------------------------------------------------------
-- 20261210000000_farm_switches_two.sql
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 20261211000000_field_gm_cost.sql
-- ---------------------------------------------------------------------------
-- A paddock's own gross margin cost ($ per hectare), used by the Gross margin report in place of the crop's cost spread over its
-- area. Empty means "use the crop's". Safe to run more than once. The same row security as the rest of the paddock applies.

alter table fields add column if not exists gm_cost_ha numeric;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261212000000_farm_switches_three.sql
-- ---------------------------------------------------------------------------
-- One more switch an owner can turn on. Safe to run more than once. Run after 20261210000000_farm_switches_two.sql.
--
-- Same promise as the others: off until the owner turns it on, and a farm with it off follows the standard rules. The policies
-- sit beside the existing ones (a restrictive policy takes away access: policies are joined with AND). To go back to the standard
-- rules for good, drop the two named here.
--
-- Switch (the key saved in farms.switches):
--   managerHidesBills    a manager is not sent invoices or bills
--
-- (The Sales tab for a worker and the Storage tab for a driver are app-only: the database already lets every member read contracts
-- without prices, and silos.)

drop policy if exists invoices_manager_hidden on invoices;
create policy invoices_manager_hidden on invoices as restrictive for select
  using (app_role(farm_id) is distinct from 'manager' or not app_switch(farm_id, 'managerHidesBills'));

drop policy if exists payables_manager_hidden on payables;
create policy payables_manager_hidden on payables as restrictive for select
  using (app_role(farm_id) is distinct from 'manager' or not app_switch(farm_id, 'managerHidesBills'));

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261213000000_movement_truck_company.sql
-- ---------------------------------------------------------------------------
-- The trucking company that carted a load, typed on the load ticket (the truck's rego and the driver are already there). Optional: empty
-- means not said. Safe to run more than once. The same row security as the rest of the load applies.

alter table movements add column if not exists truck_company text;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261214000000_storage_property.sql
-- ---------------------------------------------------------------------------
-- The farm or site a silo, bunker or tally storage sits on (a paddock already has its Farm). Optional: empty means not said.
-- Safe to run more than once. The same row security as the rest of the storage applies.

alter table storages add column if not exists property text;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261215000000_movement_driver_signature.sql
-- ---------------------------------------------------------------------------
-- The driver's signature on a load, drawn on the phone: the lines it was drawn with, the name under it, when, and a short print of
-- what the load said at that moment (so a later change to the load can be flagged). Optional: empty means not signed.
-- Safe to run more than once. The same row security as the rest of the load applies.

alter table movements add column if not exists driver_signature jsonb;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261216000000_movement_driver_phone.sql
-- ---------------------------------------------------------------------------
-- The driver's phone number on a load ticket, typed on the load (the truck's rego, the driver and the transport company are already there).
-- Optional: empty means not said. Safe to run more than once. The same row security as the rest of the load applies.

alter table movements add column if not exists driver_phone text;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261217000000_remove_member.sql
-- ---------------------------------------------------------------------------
-- Taking someone off the farm, which the server was refusing ("new row violates row-level security policy for table farm_users").
--
-- Removing a member stamps deleted_at on their farm_users row (the row stays, so inviting them again brings them straight back).
-- Postgres checks the NEW row of an UPDATE against the SELECT policy as well as the UPDATE policy, and farm_users_select only
-- shows rows where deleted_at is null, so the update that stamps deleted_at failed, for the owner too. This is the same fault as
-- withdrawing an invitation: see 20261118200000_revoke_invitation.sql and 20261111150000_soft_delete_function.sql.
--
-- This does the stamping as the definer, after checking the rule the update policy states (only an owner of the farm), and one
-- more: a farm is never left without an owner. Idempotent: safe to run again.

create or replace function remove_member(p_farm uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if app_role(p_farm) is distinct from 'owner' then
    raise exception 'not allowed';
  end if;

  select role into v_role
    from farm_users
   where farm_id = p_farm and user_id = p_user and deleted_at is null
   limit 1;
  if v_role is null then
    return;                                   -- already off the farm, or never on it: nothing to do
  end if;

  if v_role = 'owner' and not exists (
    select 1 from farm_users
     where farm_id = p_farm and role = 'owner' and deleted_at is null and user_id <> p_user
       and (expires_at is null or expires_at > now())
  ) then
    raise exception 'a farm needs at least one owner. Make someone else an owner first.';
  end if;

  update farm_users set deleted_at = now(), updated_at = now()
   where farm_id = p_farm and user_id = p_user and deleted_at is null;
end;
$$;

revoke all on function remove_member(uuid, uuid) from public;
grant execute on function remove_member(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261218000000_soft_delete_many.sql
-- ---------------------------------------------------------------------------
-- Deleting many records in one call.
--
-- Clearing a sample farm, or a whole season, deletes hundreds of rows. The app was sending each as two requests (the plain update the
-- server always refuses, then soft_delete_row), one after another: a phone on a weak signal took minutes, and the Settings screen
-- said "Not yet on the server" for all of that time.
--
-- This takes a table and a list of ids and applies soft_delete_row to each, so every rule it holds (who may delete what, owner only
-- for a season, the farm's own delete switch) applies exactly as before. If any one of them is refused the whole call is refused and
-- nothing in it is deleted; the app then falls back to one at a time, so the one that is stuck is named. At most 200 ids at a time.
-- Idempotent: safe to run again.

create or replace function soft_delete_rows(p_table text, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 200 then
    raise exception 'too many at once';
  end if;
  foreach v_id in array coalesce(p_ids, '{}'::uuid[]) loop
    perform soft_delete_row(p_table, v_id);
  end loop;
end;
$$;

revoke all on function soft_delete_rows(text, uuid[]) from public;
grant execute on function soft_delete_rows(text, uuid[]) to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261219000000_bookkeeper_narrower.sql
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 20261220000000_access_levels.sql
-- ---------------------------------------------------------------------------
-- What an owner can take away from a role, area by area ("Who can do what" under People in Settings).
-- Safe to run more than once.
--
-- The choices are kept with the farm: farms.switches -> 'levels' -> area -> role = 'none' | 'tonnes' | 'view' | 'full'. They only
-- ever take access away from what the standard rules and the other switches give, so they are RESTRICTIVE policies, which sit
-- beside the existing ones and are joined with AND (see 20261209000000_farm_switches.sql):
--   none     the rows of that area are not sent to that role at all, and cannot be written
--   view     they are sent, but cannot be added to or changed
--   tonnes   (contracts only) the contracts are sent but their terms, where the prices are, are not
-- A farm with no choices saved behaves exactly as it did before this was run: app_cell() is empty for every role and every
-- policy below lets the row through. An owner is never in the list (the app never saves a choice for one), so an owner is never held back.
-- To go back to the standard rules for good, drop the policies named *_level_* and the function app_cell().

-- The owner's choice for the signed-in person's role in an area on this farm, or empty when none was made.
create or replace function app_cell(p_farm uuid, p_area text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select f.switches -> 'levels' -> p_area ->> app_role(p_farm) from farms f where f.id = p_farm and f.deleted_at is null), '')
$$;

revoke all on function app_cell(uuid, text) from public;
grant execute on function app_cell(uuid, text) to authenticated;

-- production: paddocks and their agronomy
drop policy if exists fields_level_select on fields;
create policy fields_level_select on fields as restrictive for select
  using (app_cell(farm_id, 'production') not in ('none'));
drop policy if exists fields_level_insert on fields;
create policy fields_level_insert on fields as restrictive for insert
  with check (app_cell(farm_id, 'production') not in ('none', 'view', 'tonnes'));
drop policy if exists fields_level_update on fields;
create policy fields_level_update on fields as restrictive for update
  using (app_cell(farm_id, 'production') not in ('none', 'view', 'tonnes'))
  with check (app_cell(farm_id, 'production') not in ('none', 'view', 'tonnes'));
drop policy if exists field_agronomy_level_select on field_agronomy;
create policy field_agronomy_level_select on field_agronomy as restrictive for select
  using (app_cell(farm_id, 'production') not in ('none'));
drop policy if exists field_agronomy_level_insert on field_agronomy;
create policy field_agronomy_level_insert on field_agronomy as restrictive for insert
  with check (app_cell(farm_id, 'production') not in ('none', 'view', 'tonnes'));
drop policy if exists field_agronomy_level_update on field_agronomy;
create policy field_agronomy_level_update on field_agronomy as restrictive for update
  using (app_cell(farm_id, 'production') not in ('none', 'view', 'tonnes'))
  with check (app_cell(farm_id, 'production') not in ('none', 'view', 'tonnes'));

-- contracts: contracts, their terms (the prices) and the paperwork on them
drop policy if exists sales_level_select on sales;
create policy sales_level_select on sales as restrictive for select
  using (app_cell(farm_id, 'contracts') not in ('none'));
drop policy if exists sales_level_insert on sales;
create policy sales_level_insert on sales as restrictive for insert
  with check (app_cell(farm_id, 'contracts') not in ('none', 'view', 'tonnes'));
drop policy if exists sales_level_update on sales;
create policy sales_level_update on sales as restrictive for update
  using (app_cell(farm_id, 'contracts') not in ('none', 'view', 'tonnes'))
  with check (app_cell(farm_id, 'contracts') not in ('none', 'view', 'tonnes'));
drop policy if exists sale_terms_level_select on sale_terms;
create policy sale_terms_level_select on sale_terms as restrictive for select
  using (app_cell(farm_id, 'contracts') not in ('none', 'tonnes'));
drop policy if exists sale_terms_level_insert on sale_terms;
create policy sale_terms_level_insert on sale_terms as restrictive for insert
  with check (app_cell(farm_id, 'contracts') not in ('none', 'view', 'tonnes'));
drop policy if exists sale_terms_level_update on sale_terms;
create policy sale_terms_level_update on sale_terms as restrictive for update
  using (app_cell(farm_id, 'contracts') not in ('none', 'view', 'tonnes'))
  with check (app_cell(farm_id, 'contracts') not in ('none', 'view', 'tonnes'));
drop policy if exists sale_documents_level_select on sale_documents;
create policy sale_documents_level_select on sale_documents as restrictive for select
  using (app_cell(farm_id, 'contracts') not in ('none'));
drop policy if exists sale_documents_level_insert on sale_documents;
create policy sale_documents_level_insert on sale_documents as restrictive for insert
  with check (app_cell(farm_id, 'contracts') not in ('none', 'view', 'tonnes'));
drop policy if exists sale_documents_level_update on sale_documents;
create policy sale_documents_level_update on sale_documents as restrictive for update
  using (app_cell(farm_id, 'contracts') not in ('none', 'view', 'tonnes'))
  with check (app_cell(farm_id, 'contracts') not in ('none', 'view', 'tonnes'));

-- invoices: invoices
drop policy if exists invoices_level_select on invoices;
create policy invoices_level_select on invoices as restrictive for select
  using (app_cell(farm_id, 'invoices') not in ('none'));
drop policy if exists invoices_level_insert on invoices;
create policy invoices_level_insert on invoices as restrictive for insert
  with check (app_cell(farm_id, 'invoices') not in ('none', 'view', 'tonnes'));
drop policy if exists invoices_level_update on invoices;
create policy invoices_level_update on invoices as restrictive for update
  using (app_cell(farm_id, 'invoices') not in ('none', 'view', 'tonnes'))
  with check (app_cell(farm_id, 'invoices') not in ('none', 'view', 'tonnes'));

-- bills: bills
drop policy if exists payables_level_select on payables;
create policy payables_level_select on payables as restrictive for select
  using (app_cell(farm_id, 'bills') not in ('none'));
drop policy if exists payables_level_insert on payables;
create policy payables_level_insert on payables as restrictive for insert
  with check (app_cell(farm_id, 'bills') not in ('none', 'view', 'tonnes'));
drop policy if exists payables_level_update on payables;
create policy payables_level_update on payables as restrictive for update
  using (app_cell(farm_id, 'bills') not in ('none', 'view', 'tonnes'))
  with check (app_cell(farm_id, 'bills') not in ('none', 'view', 'tonnes'));

-- overheads: whole-farm overheads
drop policy if exists overheads_level_select on overheads;
create policy overheads_level_select on overheads as restrictive for select
  using (app_cell(farm_id, 'overheads') not in ('none'));
drop policy if exists overheads_level_insert on overheads;
create policy overheads_level_insert on overheads as restrictive for insert
  with check (app_cell(farm_id, 'overheads') not in ('none', 'view', 'tonnes'));
drop policy if exists overheads_level_update on overheads;
create policy overheads_level_update on overheads as restrictive for update
  using (app_cell(farm_id, 'overheads') not in ('none', 'view', 'tonnes'))
  with check (app_cell(farm_id, 'overheads') not in ('none', 'view', 'tonnes'));

-- grainorders: grain orders
drop policy if exists orders_level_select on orders;
create policy orders_level_select on orders as restrictive for select
  using (app_cell(farm_id, 'grainorders') not in ('none'));
drop policy if exists orders_level_insert on orders;
create policy orders_level_insert on orders as restrictive for insert
  with check (app_cell(farm_id, 'grainorders') not in ('none', 'view', 'tonnes'));
drop policy if exists orders_level_update on orders;
create policy orders_level_update on orders as restrictive for update
  using (app_cell(farm_id, 'grainorders') not in ('none', 'view', 'tonnes'))
  with check (app_cell(farm_id, 'grainorders') not in ('none', 'view', 'tonnes'));

-- freightorders: freight orders
drop policy if exists freight_orders_level_select on freight_orders;
create policy freight_orders_level_select on freight_orders as restrictive for select
  using (app_cell(farm_id, 'freightorders') not in ('none'));
drop policy if exists freight_orders_level_insert on freight_orders;
create policy freight_orders_level_insert on freight_orders as restrictive for insert
  with check (app_cell(farm_id, 'freightorders') not in ('none', 'view', 'tonnes'));
drop policy if exists freight_orders_level_update on freight_orders;
create policy freight_orders_level_update on freight_orders as restrictive for update
  using (app_cell(farm_id, 'freightorders') not in ('none', 'view', 'tonnes'))
  with check (app_cell(farm_id, 'freightorders') not in ('none', 'view', 'tonnes'));

-- loads: loads, their legs and photos
drop policy if exists movements_level_select on movements;
create policy movements_level_select on movements as restrictive for select
  using (app_cell(farm_id, 'loads') not in ('none'));
drop policy if exists movements_level_insert on movements;
create policy movements_level_insert on movements as restrictive for insert
  with check (app_cell(farm_id, 'loads') not in ('none', 'view', 'tonnes'));
drop policy if exists movements_level_update on movements;
create policy movements_level_update on movements as restrictive for update
  using (app_cell(farm_id, 'loads') not in ('none', 'view', 'tonnes'))
  with check (app_cell(farm_id, 'loads') not in ('none', 'view', 'tonnes'));
drop policy if exists movement_legs_level_select on movement_legs;
create policy movement_legs_level_select on movement_legs as restrictive for select
  using (app_cell(farm_id, 'loads') not in ('none'));
drop policy if exists movement_legs_level_insert on movement_legs;
create policy movement_legs_level_insert on movement_legs as restrictive for insert
  with check (app_cell(farm_id, 'loads') not in ('none', 'view', 'tonnes'));
drop policy if exists movement_legs_level_update on movement_legs;
create policy movement_legs_level_update on movement_legs as restrictive for update
  using (app_cell(farm_id, 'loads') not in ('none', 'view', 'tonnes'))
  with check (app_cell(farm_id, 'loads') not in ('none', 'view', 'tonnes'));
drop policy if exists movement_photos_level_select on movement_photos;
create policy movement_photos_level_select on movement_photos as restrictive for select
  using (app_cell(farm_id, 'loads') not in ('none'));
drop policy if exists movement_photos_level_insert on movement_photos;
create policy movement_photos_level_insert on movement_photos as restrictive for insert
  with check (app_cell(farm_id, 'loads') not in ('none', 'view', 'tonnes'));
drop policy if exists movement_photos_level_update on movement_photos;
create policy movement_photos_level_update on movement_photos as restrictive for update
  using (app_cell(farm_id, 'loads') not in ('none', 'view', 'tonnes'))
  with check (app_cell(farm_id, 'loads') not in ('none', 'view', 'tonnes'));

-- sprays: spray requests
drop policy if exists spray_jobs_level_select on spray_jobs;
create policy spray_jobs_level_select on spray_jobs as restrictive for select
  using (app_cell(farm_id, 'sprays') not in ('none'));
drop policy if exists spray_jobs_level_insert on spray_jobs;
create policy spray_jobs_level_insert on spray_jobs as restrictive for insert
  with check (app_cell(farm_id, 'sprays') not in ('none', 'view', 'tonnes'));
drop policy if exists spray_jobs_level_update on spray_jobs;
create policy spray_jobs_level_update on spray_jobs as restrictive for update
  using (app_cell(farm_id, 'sprays') not in ('none', 'view', 'tonnes'))
  with check (app_cell(farm_id, 'sprays') not in ('none', 'view', 'tonnes'));

-- inputs: seed, fertiliser, fuel and chemical stock
drop policy if exists input_stock_level_select on input_stock;
create policy input_stock_level_select on input_stock as restrictive for select
  using (app_cell(farm_id, 'inputs') not in ('none'));
drop policy if exists input_stock_level_insert on input_stock;
create policy input_stock_level_insert on input_stock as restrictive for insert
  with check (app_cell(farm_id, 'inputs') not in ('none', 'view', 'tonnes'));
drop policy if exists input_stock_level_update on input_stock;
create policy input_stock_level_update on input_stock as restrictive for update
  using (app_cell(farm_id, 'inputs') not in ('none', 'view', 'tonnes'))
  with check (app_cell(farm_id, 'inputs') not in ('none', 'view', 'tonnes'));

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 20261221000000_access_raise.sql
-- ---------------------------------------------------------------------------
-- What an owner can GIVE a role, area by area ("Who can do what" under People in Settings): raising above the standard rules.
-- Safe to run more than once. Run it after 20261220000000_access_levels.sql (which takes access away; this adds it).
--
-- The pick saved with the farm (farms.switches -> 'levels' -> area -> role) is now the whole answer for that role in that area:
--   none / tonnes   as before (the restrictive policies in 20261220000000 hold the rows, or the prices, back)
--   view            the rows are sent, even where the standard rules would not send them to that role
--   full            the rows are sent and the role may add them and change them
-- These are ordinary (permissive) policies, which sit beside the standard ones and are joined with OR, so they can only ever add
-- access for a role the owner has picked for. A farm with no picks saved is exactly as it was: app_cell() is empty for every role.
-- Rules inside an area stay: a driver's own loads, final weights, who deletes. Deleting still goes through soft_delete_row(), which
-- keeps its own role checks. To go back for good, drop the policies named *_raise_*.

-- production
drop policy if exists fields_raise_select on fields;
create policy fields_raise_select on fields for select
  using (app_cell(farm_id, 'production') in ('view', 'full') and deleted_at is null);
drop policy if exists fields_raise_insert on fields;
create policy fields_raise_insert on fields for insert
  with check (app_cell(farm_id, 'production') = 'full');
drop policy if exists fields_raise_update on fields;
create policy fields_raise_update on fields for update
  using (app_cell(farm_id, 'production') = 'full')
  with check (app_cell(farm_id, 'production') = 'full');
drop policy if exists field_agronomy_raise_select on field_agronomy;
create policy field_agronomy_raise_select on field_agronomy for select
  using (app_cell(farm_id, 'production') in ('view', 'full') and deleted_at is null);
drop policy if exists field_agronomy_raise_insert on field_agronomy;
create policy field_agronomy_raise_insert on field_agronomy for insert
  with check (app_cell(farm_id, 'production') = 'full');
drop policy if exists field_agronomy_raise_update on field_agronomy;
create policy field_agronomy_raise_update on field_agronomy for update
  using (app_cell(farm_id, 'production') = 'full')
  with check (app_cell(farm_id, 'production') = 'full');

-- contracts
drop policy if exists sales_raise_select on sales;
create policy sales_raise_select on sales for select
  using (app_cell(farm_id, 'contracts') in ('tonnes', 'view', 'full') and deleted_at is null);
drop policy if exists sales_raise_insert on sales;
create policy sales_raise_insert on sales for insert
  with check (app_cell(farm_id, 'contracts') = 'full');
drop policy if exists sales_raise_update on sales;
create policy sales_raise_update on sales for update
  using (app_cell(farm_id, 'contracts') = 'full')
  with check (app_cell(farm_id, 'contracts') = 'full');
drop policy if exists sale_terms_raise_select on sale_terms;
create policy sale_terms_raise_select on sale_terms for select
  using (app_cell(farm_id, 'contracts') in ('view', 'full') and deleted_at is null);
drop policy if exists sale_terms_raise_insert on sale_terms;
create policy sale_terms_raise_insert on sale_terms for insert
  with check (app_cell(farm_id, 'contracts') = 'full');
drop policy if exists sale_terms_raise_update on sale_terms;
create policy sale_terms_raise_update on sale_terms for update
  using (app_cell(farm_id, 'contracts') = 'full')
  with check (app_cell(farm_id, 'contracts') = 'full');
drop policy if exists sale_documents_raise_select on sale_documents;
create policy sale_documents_raise_select on sale_documents for select
  using (app_cell(farm_id, 'contracts') in ('view', 'full') and deleted_at is null);
drop policy if exists sale_documents_raise_insert on sale_documents;
create policy sale_documents_raise_insert on sale_documents for insert
  with check (app_cell(farm_id, 'contracts') = 'full');
drop policy if exists sale_documents_raise_update on sale_documents;
create policy sale_documents_raise_update on sale_documents for update
  using (app_cell(farm_id, 'contracts') = 'full')
  with check (app_cell(farm_id, 'contracts') = 'full');

-- invoices
drop policy if exists invoices_raise_select on invoices;
create policy invoices_raise_select on invoices for select
  using (app_cell(farm_id, 'invoices') in ('view', 'full') and deleted_at is null);
drop policy if exists invoices_raise_insert on invoices;
create policy invoices_raise_insert on invoices for insert
  with check (app_cell(farm_id, 'invoices') = 'full');
drop policy if exists invoices_raise_update on invoices;
create policy invoices_raise_update on invoices for update
  using (app_cell(farm_id, 'invoices') = 'full')
  with check (app_cell(farm_id, 'invoices') = 'full');

-- bills
drop policy if exists payables_raise_select on payables;
create policy payables_raise_select on payables for select
  using (app_cell(farm_id, 'bills') in ('view', 'full') and deleted_at is null);
drop policy if exists payables_raise_insert on payables;
create policy payables_raise_insert on payables for insert
  with check (app_cell(farm_id, 'bills') = 'full');
drop policy if exists payables_raise_update on payables;
create policy payables_raise_update on payables for update
  using (app_cell(farm_id, 'bills') = 'full')
  with check (app_cell(farm_id, 'bills') = 'full');

-- overheads
drop policy if exists overheads_raise_select on overheads;
create policy overheads_raise_select on overheads for select
  using (app_cell(farm_id, 'overheads') in ('view', 'full') and deleted_at is null);
drop policy if exists overheads_raise_insert on overheads;
create policy overheads_raise_insert on overheads for insert
  with check (app_cell(farm_id, 'overheads') = 'full');
drop policy if exists overheads_raise_update on overheads;
create policy overheads_raise_update on overheads for update
  using (app_cell(farm_id, 'overheads') = 'full')
  with check (app_cell(farm_id, 'overheads') = 'full');

-- grainorders
drop policy if exists orders_raise_select on orders;
create policy orders_raise_select on orders for select
  using (app_cell(farm_id, 'grainorders') in ('view', 'full') and deleted_at is null);
drop policy if exists orders_raise_insert on orders;
create policy orders_raise_insert on orders for insert
  with check (app_cell(farm_id, 'grainorders') = 'full');
drop policy if exists orders_raise_update on orders;
create policy orders_raise_update on orders for update
  using (app_cell(farm_id, 'grainorders') = 'full')
  with check (app_cell(farm_id, 'grainorders') = 'full');

-- freightorders
drop policy if exists freight_orders_raise_select on freight_orders;
create policy freight_orders_raise_select on freight_orders for select
  using (app_cell(farm_id, 'freightorders') in ('view', 'full') and deleted_at is null);
drop policy if exists freight_orders_raise_insert on freight_orders;
create policy freight_orders_raise_insert on freight_orders for insert
  with check (app_cell(farm_id, 'freightorders') = 'full');
drop policy if exists freight_orders_raise_update on freight_orders;
create policy freight_orders_raise_update on freight_orders for update
  using (app_cell(farm_id, 'freightorders') = 'full')
  with check (app_cell(farm_id, 'freightorders') = 'full');

-- loads
drop policy if exists movements_raise_select on movements;
create policy movements_raise_select on movements for select
  using (app_cell(farm_id, 'loads') in ('view', 'full') and deleted_at is null);
drop policy if exists movements_raise_insert on movements;
create policy movements_raise_insert on movements for insert
  with check (app_cell(farm_id, 'loads') = 'full');
drop policy if exists movements_raise_update on movements;
create policy movements_raise_update on movements for update
  using (app_cell(farm_id, 'loads') = 'full')
  with check (app_cell(farm_id, 'loads') = 'full');
drop policy if exists movement_legs_raise_select on movement_legs;
create policy movement_legs_raise_select on movement_legs for select
  using (app_cell(farm_id, 'loads') in ('view', 'full') and deleted_at is null);
drop policy if exists movement_legs_raise_insert on movement_legs;
create policy movement_legs_raise_insert on movement_legs for insert
  with check (app_cell(farm_id, 'loads') = 'full');
drop policy if exists movement_legs_raise_update on movement_legs;
create policy movement_legs_raise_update on movement_legs for update
  using (app_cell(farm_id, 'loads') = 'full')
  with check (app_cell(farm_id, 'loads') = 'full');
drop policy if exists movement_photos_raise_select on movement_photos;
create policy movement_photos_raise_select on movement_photos for select
  using (app_cell(farm_id, 'loads') in ('view', 'full') and deleted_at is null);
drop policy if exists movement_photos_raise_insert on movement_photos;
create policy movement_photos_raise_insert on movement_photos for insert
  with check (app_cell(farm_id, 'loads') = 'full');
drop policy if exists movement_photos_raise_update on movement_photos;
create policy movement_photos_raise_update on movement_photos for update
  using (app_cell(farm_id, 'loads') = 'full')
  with check (app_cell(farm_id, 'loads') = 'full');

-- sprays
drop policy if exists spray_jobs_raise_select on spray_jobs;
create policy spray_jobs_raise_select on spray_jobs for select
  using (app_cell(farm_id, 'sprays') in ('view', 'full') and deleted_at is null);
drop policy if exists spray_jobs_raise_insert on spray_jobs;
create policy spray_jobs_raise_insert on spray_jobs for insert
  with check (app_cell(farm_id, 'sprays') = 'full');
drop policy if exists spray_jobs_raise_update on spray_jobs;
create policy spray_jobs_raise_update on spray_jobs for update
  using (app_cell(farm_id, 'sprays') = 'full')
  with check (app_cell(farm_id, 'sprays') = 'full');

-- inputs
drop policy if exists input_stock_raise_select on input_stock;
create policy input_stock_raise_select on input_stock for select
  using (app_cell(farm_id, 'inputs') in ('view', 'full') and deleted_at is null);
drop policy if exists input_stock_raise_insert on input_stock;
create policy input_stock_raise_insert on input_stock for insert
  with check (app_cell(farm_id, 'inputs') = 'full');
drop policy if exists input_stock_raise_update on input_stock;
create policy input_stock_raise_update on input_stock for update
  using (app_cell(farm_id, 'inputs') = 'full')
  with check (app_cell(farm_id, 'inputs') = 'full');

-- The switches that hold rows back from a kind of login now give way to the owner's pick for that login in that area.
drop policy if exists movements_advisor_loads on movements;
create policy movements_advisor_loads on movements as restrictive for select
  using (app_role(farm_id) is distinct from 'advisor' or app_switch(farm_id, 'advisorSeesLoads') or app_cell(farm_id, 'loads') in ('view', 'full'));
drop policy if exists movement_legs_advisor_loads on movement_legs;
create policy movement_legs_advisor_loads on movement_legs as restrictive for select
  using (app_role(farm_id) is distinct from 'advisor' or app_switch(farm_id, 'advisorSeesLoads') or app_cell(farm_id, 'loads') in ('view', 'full'));
drop policy if exists movement_photos_advisor_loads on movement_photos;
create policy movement_photos_advisor_loads on movement_photos as restrictive for select
  using (app_role(farm_id) is distinct from 'advisor' or app_switch(farm_id, 'advisorSeesLoads') or app_cell(farm_id, 'loads') in ('view', 'full'));
drop policy if exists sales_advisor_loads on sales;
create policy sales_advisor_loads on sales as restrictive for select
  using (app_role(farm_id) is distinct from 'advisor' or app_switch(farm_id, 'advisorSeesLoads') or app_cell(farm_id, 'contracts') in ('tonnes', 'view', 'full'));
drop policy if exists orders_advisor_prices on orders;
create policy orders_advisor_prices on orders as restrictive for select
  using (app_role(farm_id) is distinct from 'advisor' or app_switch(farm_id, 'advisorSeesPrices') or app_cell(farm_id, 'grainorders') in ('view', 'full'));
drop policy if exists invoices_manager_hidden on invoices;
create policy invoices_manager_hidden on invoices as restrictive for select
  using (app_role(farm_id) is distinct from 'manager' or not app_switch(farm_id, 'managerHidesBills') or app_cell(farm_id, 'invoices') in ('view', 'full'));
drop policy if exists payables_manager_hidden on payables;
create policy payables_manager_hidden on payables as restrictive for select
  using (app_role(farm_id) is distinct from 'manager' or not app_switch(farm_id, 'managerHidesBills') or app_cell(farm_id, 'bills') in ('view', 'full'));

notify pgrst, 'reload schema';

