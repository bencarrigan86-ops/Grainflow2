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
