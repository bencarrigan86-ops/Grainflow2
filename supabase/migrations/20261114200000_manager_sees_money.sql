-- Managers see the money side too: invoices (receivables) and bills (payables).
--
-- Until now both were owner and bookkeeper only. A manager runs the farm day to day and needs to see what is owed to
-- and by it, so they join the owner and the bookkeeper on both tables. Drivers and farm workers still see neither.

drop policy if exists invoices_select on invoices;
create policy invoices_select on invoices for select
  using (app_role(farm_id) in ('owner', 'manager', 'bookkeeper') and deleted_at is null);

drop policy if exists invoices_insert on invoices;
create policy invoices_insert on invoices for insert
  with check (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'));

drop policy if exists invoices_update on invoices;
create policy invoices_update on invoices for update
  using (app_role(farm_id) in ('owner', 'manager', 'bookkeeper')
         and app_may_manage_row(farm_id, created_by))
  with check (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'));

drop policy if exists payables_select on payables;
create policy payables_select on payables for select
  using (app_role(farm_id) in ('owner', 'manager', 'bookkeeper') and deleted_at is null);

drop policy if exists payables_insert on payables;
create policy payables_insert on payables for insert
  with check (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'));

drop policy if exists payables_update on payables;
create policy payables_update on payables for update
  using (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'))
  with check (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'));
