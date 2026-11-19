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
