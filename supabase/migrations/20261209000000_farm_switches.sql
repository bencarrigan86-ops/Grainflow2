-- Switches a farm's owner can turn on, to change what a role can see. Safe to run more than once.
--
-- The standard rules stay exactly as they were: every switch is off until the owner turns it on, and a farm with every
-- switch off behaves as it did before this was run. The policies below do not change the existing ones. They sit beside
-- them:
--   - a permissive policy ADDS access (policies are joined with OR), used where a switch lets a role see more;
--   - a restrictive policy TAKES AWAY access (policies are joined with AND), used where a switch narrows a role.
-- To go back to the standard rules for good, drop the policies named here; nothing else was touched.
--
-- Switches (the key is what is saved in farms.switches):
--   managerSeesPrices      managers read contract prices and terms (sale_terms)
--   managerSeesOverheads   managers read overheads, so the whole farm's profit
--   workerSeesYields       (app only: yields are not held back from a worker by the database)
--   workerSeesPosition     (app only: a worker already reads the loads and contracts Position is built from)
--   driverOwnLoadsOnly     a driver sees only the loads they entered themselves

alter table farms add column if not exists switches jsonb not null default '{}'::jsonb;

-- Is a switch on for this farm? Missing, or anything but true, is off.
create or replace function app_switch(p_farm uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select f.switches ->> p_key = 'true' from farms f where f.id = p_farm and f.deleted_at is null), false)
$$;

-- managerSeesPrices: a manager reads the contract terms, where the price lives
drop policy if exists sale_terms_manager_switch on sale_terms;
create policy sale_terms_manager_switch on sale_terms for select
  using (app_role(farm_id) = 'manager' and app_switch(farm_id, 'managerSeesPrices') and deleted_at is null);

-- managerSeesOverheads: a manager reads the whole-farm overheads
drop policy if exists overheads_manager_switch on overheads;
create policy overheads_manager_switch on overheads for select
  using (app_role(farm_id) = 'manager' and app_switch(farm_id, 'managerSeesOverheads') and deleted_at is null);

-- driverOwnLoadsOnly: with the switch on, a driver is sent only the loads they entered, and the legs and photos of those
drop policy if exists movements_driver_own_only on movements;
create policy movements_driver_own_only on movements as restrictive for select
  using (not (app_role(farm_id) = 'driver' and app_switch(farm_id, 'driverOwnLoadsOnly')) or created_by = auth.uid());

drop policy if exists movement_legs_driver_own_only on movement_legs;
create policy movement_legs_driver_own_only on movement_legs as restrictive for select
  using (
    not (app_role(farm_id) = 'driver' and app_switch(farm_id, 'driverOwnLoadsOnly'))
    or exists (select 1 from movements m where m.id = movement_id and m.created_by = auth.uid())
  );

drop policy if exists movement_photos_driver_own_only on movement_photos;
create policy movement_photos_driver_own_only on movement_photos as restrictive for select
  using (
    not (app_role(farm_id) = 'driver' and app_switch(farm_id, 'driverOwnLoadsOnly'))
    or exists (select 1 from movements m where m.id = movement_id and m.created_by = auth.uid())
  );

notify pgrst, 'reload schema';
