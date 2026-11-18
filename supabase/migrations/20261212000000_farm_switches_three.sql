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
