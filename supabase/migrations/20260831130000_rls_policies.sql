-- Grainflow — row-level security policies
--
-- Five roles, three policy families. The families are commercial (owner,
-- bookkeeper), operational (manager) and field (farm_worker, driver); the two
-- field roles differ in exactly one thing, which is why can_write_production is
-- a flag on farm_users rather than two separate policy sets.
--
-- Two rules run through everything below:
--
--   Nothing is hard-deleted, so there are no DELETE policies. A soft delete is
--   an UPDATE that stamps deleted_at, and it is governed by the UPDATE policy:
--   you may remove what you created, and owners and managers may remove
--   anyone's.
--
--   Restricted data is never merely hidden. sale_terms, field_agronomy,
--   overheads and invoices are absent from a field user's SELECT entirely, so
--   when Phase 3 adds sync rules there is nothing to leak — the rows never
--   reach the device.
--
-- Note the deliberate split between what a role can SEE and what appears in
-- their tab bar. A driver has no Production or Sales tab, but must still read
-- `fields` and `sales` to pick the paddock a load came out of and the contract
-- it is going against. The tab list is interface; this file is security.

-- ---------------------------------------------------------------------------
-- Helpers
--
-- security definer is not optional here. A policy on farm_users that selects
-- from farm_users would recurse forever; running the lookup as the definer
-- steps outside RLS and breaks the cycle. search_path is pinned because a
-- definer function with a mutable search_path is a privilege-escalation hole.
-- ---------------------------------------------------------------------------

create or replace function app_role(p_farm uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
    from farm_users
   where farm_id = p_farm
     and user_id = auth.uid()
     and deleted_at is null
   limit 1
$$;

create or replace function app_is_member(p_farm uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app_role(p_farm) is not null
$$;

create or replace function app_can_write_production(p_farm uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select can_write_production
       from farm_users
      where farm_id = p_farm
        and user_id = auth.uid()
        and deleted_at is null
      limit 1), false)
$$;

-- Owner and manager may act on anyone's records. Everyone else, their own.
create or replace function app_may_manage_row(p_farm uuid, p_created_by uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app_role(p_farm) in ('owner','manager')
      or p_created_by = auth.uid()
$$;

-- Signing up is a chicken-and-egg problem: you cannot insert a farm you are not
-- yet a member of, and you cannot be a member of a farm that does not exist.
-- This does both in one transaction, as the definer.
create or replace function create_farm(p_farm_id uuid, p_entity_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into farms (id, entity_name, created_by, updated_by, trial_ends_at)
  values (p_farm_id, p_entity_name, auth.uid(), auth.uid(), now() + interval '1 year');

  insert into farm_users (id, farm_id, user_id, role, can_write_production, created_by, updated_by)
  values (gen_random_uuid(), p_farm_id, auth.uid(), 'owner', true, auth.uid(), auth.uid());

  return p_farm_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- farms — every member reads; only the owner edits
-- ---------------------------------------------------------------------------

create policy farms_select on farms for select
  using (app_is_member(id) and deleted_at is null);

create policy farms_update on farms for update
  using (app_role(id) = 'owner')
  with check (app_role(id) = 'owner');

-- ---------------------------------------------------------------------------
-- farm_users and invitations — the owner runs the roster
-- ---------------------------------------------------------------------------

create policy farm_users_select on farm_users for select
  using (app_is_member(farm_id) and deleted_at is null);

create policy farm_users_insert on farm_users for insert
  with check (app_role(farm_id) = 'owner');

create policy farm_users_update on farm_users for update
  using (app_role(farm_id) = 'owner')
  with check (app_role(farm_id) = 'owner');

create policy invitations_select on invitations for select
  using (app_role(farm_id) = 'owner' and deleted_at is null);

create policy invitations_insert on invitations for insert
  with check (app_role(farm_id) = 'owner');

create policy invitations_update on invitations for update
  using (app_role(farm_id) = 'owner')
  with check (app_role(farm_id) = 'owner');

-- ---------------------------------------------------------------------------
-- number_leases — any member may lease, because any member may create a ticket
-- ---------------------------------------------------------------------------

create policy number_leases_select on number_leases for select
  using (app_is_member(farm_id) and deleted_at is null);

create policy number_leases_insert on number_leases for insert
  with check (app_is_member(farm_id));

create policy number_leases_update on number_leases for update
  using (app_is_member(farm_id))
  with check (app_is_member(farm_id));

-- ---------------------------------------------------------------------------
-- seasons, commodities, storages — everyone reads, owner and manager write
--
-- Drivers read storages because they must pick the silo they are tipping into.
-- ---------------------------------------------------------------------------

create policy seasons_select on seasons for select
  using (app_is_member(farm_id) and deleted_at is null);
create policy seasons_insert on seasons for insert
  with check (app_role(farm_id) in ('owner','manager'));
create policy seasons_update on seasons for update
  using (app_role(farm_id) in ('owner','manager'))
  with check (app_role(farm_id) in ('owner','manager'));

create policy commodities_select on commodities for select
  using (app_is_member(farm_id) and deleted_at is null);
create policy commodities_insert on commodities for insert
  with check (app_role(farm_id) in ('owner','manager'));
create policy commodities_update on commodities for update
  using (app_role(farm_id) in ('owner','manager'))
  with check (app_role(farm_id) in ('owner','manager'));

create policy storages_select on storages for select
  using (app_is_member(farm_id) and deleted_at is null);
create policy storages_insert on storages for insert
  with check (app_role(farm_id) in ('owner','manager'));
create policy storages_update on storages for update
  using (app_role(farm_id) in ('owner','manager'))
  with check (app_role(farm_id) in ('owner','manager'));

-- ---------------------------------------------------------------------------
-- fields — everyone reads the paddock list; the agronomy behind it is narrower
-- ---------------------------------------------------------------------------

create policy fields_select on fields for select
  using (app_is_member(farm_id) and deleted_at is null);

create policy fields_insert on fields for insert
  with check (
    app_role(farm_id) in ('owner','manager')
    or (app_role(farm_id) = 'farm_worker' and app_can_write_production(farm_id))
  );

create policy fields_update on fields for update
  using (
    (app_role(farm_id) in ('owner','manager')
     or (app_role(farm_id) = 'farm_worker' and app_can_write_production(farm_id)))
    and app_may_manage_row(farm_id, created_by)
  )
  with check (
    app_role(farm_id) in ('owner','manager')
    or (app_role(farm_id) = 'farm_worker' and app_can_write_production(farm_id))
  );

-- A driver never receives this table at all — it is the agronomy program, and
-- a contract carrier has no business with it.
create policy field_agronomy_select on field_agronomy for select
  using (
    app_role(farm_id) in ('owner','manager','bookkeeper','farm_worker')
    and deleted_at is null
  );

create policy field_agronomy_insert on field_agronomy for insert
  with check (
    app_role(farm_id) in ('owner','manager')
    or (app_role(farm_id) = 'farm_worker' and app_can_write_production(farm_id))
  );

create policy field_agronomy_update on field_agronomy for update
  using (
    (app_role(farm_id) in ('owner','manager')
     or (app_role(farm_id) = 'farm_worker' and app_can_write_production(farm_id)))
    and app_may_manage_row(farm_id, created_by)
  )
  with check (
    app_role(farm_id) in ('owner','manager')
    or (app_role(farm_id) = 'farm_worker' and app_can_write_production(farm_id))
  );

-- ---------------------------------------------------------------------------
-- sales and sale_terms
--
-- Everyone reads `sales`, including the driver — they must pick the contract
-- they are carting against. Nobody outside owner and bookkeeper reads
-- `sale_terms`, which is where the price lives. That split is the entire reason
-- these are two tables.
-- ---------------------------------------------------------------------------

create policy sales_select on sales for select
  using (app_is_member(farm_id) and deleted_at is null);

create policy sales_insert on sales for insert
  with check (app_role(farm_id) in ('owner','bookkeeper'));

create policy sales_update on sales for update
  using (app_role(farm_id) in ('owner','bookkeeper')
         and app_may_manage_row(farm_id, created_by))
  with check (app_role(farm_id) in ('owner','bookkeeper'));

create policy sale_terms_select on sale_terms for select
  using (app_role(farm_id) in ('owner','bookkeeper') and deleted_at is null);

create policy sale_terms_insert on sale_terms for insert
  with check (app_role(farm_id) in ('owner','bookkeeper'));

create policy sale_terms_update on sale_terms for update
  using (app_role(farm_id) in ('owner','bookkeeper')
         and app_may_manage_row(farm_id, created_by))
  with check (app_role(farm_id) in ('owner','bookkeeper'));

-- ---------------------------------------------------------------------------
-- movements
--
-- A load is a hand-off, not a personal record: the worker loads out of the
-- silo, the driver carts it, someone else tips it. So any field user may amend
-- any movement still open. Once it is closed it is read-only below manager.
--
-- Note the asymmetry with removal — amending a live ticket is collaborative,
-- destroying a record is not, so a soft delete still runs through
-- app_may_manage_row.
-- ---------------------------------------------------------------------------

create policy movements_select on movements for select
  using (app_is_member(farm_id) and deleted_at is null);

create policy movements_insert on movements for insert
  with check (app_role(farm_id) in ('owner','manager','farm_worker','driver'));

create policy movements_update on movements for update
  using (
    app_role(farm_id) in ('owner','manager')
    or (
      app_role(farm_id) in ('farm_worker','driver')
      and status = 'open'
      and (created_by = auth.uid() or deleted_at is null)
    )
  )
  with check (
    app_role(farm_id) in ('owner','manager')
    or (
      app_role(farm_id) in ('farm_worker','driver')
      and status = 'open'
      and (deleted_at is null or created_by = auth.uid())
    )
  );

create policy movement_legs_select on movement_legs for select
  using (app_is_member(farm_id) and deleted_at is null);

create policy movement_legs_insert on movement_legs for insert
  with check (app_role(farm_id) in ('owner','manager','farm_worker','driver'));

create policy movement_legs_update on movement_legs for update
  using (
    app_role(farm_id) in ('owner','manager')
    or (app_role(farm_id) in ('farm_worker','driver')
        and exists (select 1 from movements m
                     where m.id = movement_id and m.status = 'open'))
  )
  with check (app_role(farm_id) in ('owner','manager','farm_worker','driver'));

create policy movement_photos_select on movement_photos for select
  using (app_is_member(farm_id) and deleted_at is null);

create policy movement_photos_insert on movement_photos for insert
  with check (app_role(farm_id) in ('owner','manager','farm_worker','driver'));

create policy movement_photos_update on movement_photos for update
  using (app_may_manage_row(farm_id, created_by))
  with check (app_is_member(farm_id));

-- ---------------------------------------------------------------------------
-- invoices and overheads — the commercial family only
--
-- The manager is excluded from overheads deliberately: it is what makes their
-- Position screen show tonnes and margin per paddock without whole-farm gross
-- margin. Withholding the table is how that is enforced, not hiding a panel.
-- ---------------------------------------------------------------------------

create policy invoices_select on invoices for select
  using (app_role(farm_id) in ('owner','bookkeeper') and deleted_at is null);
create policy invoices_insert on invoices for insert
  with check (app_role(farm_id) in ('owner','bookkeeper'));
create policy invoices_update on invoices for update
  using (app_role(farm_id) in ('owner','bookkeeper')
         and app_may_manage_row(farm_id, created_by))
  with check (app_role(farm_id) in ('owner','bookkeeper'));

create policy overheads_select on overheads for select
  using (app_role(farm_id) in ('owner','bookkeeper') and deleted_at is null);
create policy overheads_insert on overheads for insert
  with check (app_role(farm_id) in ('owner','bookkeeper'));
create policy overheads_update on overheads for update
  using (app_role(farm_id) in ('owner','bookkeeper'))
  with check (app_role(farm_id) in ('owner','bookkeeper'));

-- ---------------------------------------------------------------------------
-- Grants
--
-- RLS narrows what a role may touch; it does not grant the right to touch
-- anything in the first place. Note there is no DELETE grant anywhere — the
-- schema is soft-delete only, and withholding the privilege makes that
-- structural rather than a convention someone forgets.
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

alter default privileges in schema public
  grant select, insert, update on tables to authenticated;
