-- Two security fixes. Safe to run more than once.
--
-- 1. Bank details. They sat in the farms row, and every member of a farm can read that row, so a driver's phone held the
--    farm's account number. They now live in farm_bank, which only the owner and the bookkeeper can read, and only the
--    owner can write. The old columns stay (an older copy of the app still names them) but are emptied, and a trigger
--    moves anything an older copy writes there into farm_bank.
--
-- 2. Inputs and stock for farm workers. A worker can now see what is on hand and record what is used and counts, with
--    no prices. input_stock still holds the prices, so a worker reads it only through a function that blanks them, and
--    can write only 'use' and 'adjust' entries, which carry no price.

-- ---------------------------------------------------------------------------
-- 1. farm_bank
-- ---------------------------------------------------------------------------

create table if not exists farm_bank (
  farm_id        uuid primary key references farms(id) on delete cascade,
  bank_name      text,
  account_name   text,
  bsb            text,
  account_number text,
  updated_at     timestamptz not null default now(),
  updated_by     uuid default auth.uid()
);

alter table farm_bank enable row level security;

drop policy if exists farm_bank_select on farm_bank;
create policy farm_bank_select on farm_bank for select
  using (app_role(farm_id) in ('owner', 'bookkeeper'));

drop policy if exists farm_bank_insert on farm_bank;
create policy farm_bank_insert on farm_bank for insert
  with check (app_role(farm_id) = 'owner');

drop policy if exists farm_bank_update on farm_bank;
create policy farm_bank_update on farm_bank for update
  using (app_role(farm_id) = 'owner')
  with check (app_role(farm_id) = 'owner');

grant select, insert, update on farm_bank to authenticated;

drop trigger if exists farm_bank_set_updated_at on farm_bank;
create trigger farm_bank_set_updated_at before update on farm_bank
  for each row execute function set_updated_at();

-- what is already there moves across
insert into farm_bank (farm_id, bank_name, account_name, bsb, account_number)
select id, bank_name, account_name, bsb, account_number
  from farms
 where bank_name is not null or account_name is not null or bsb is not null or account_number is not null
on conflict (farm_id) do nothing;

-- an older copy of the app still writes the bank details to the farms row: keep them out of it
create or replace function farms_move_bank()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.bank_name is not null or new.account_name is not null or new.bsb is not null or new.account_number is not null then
    insert into farm_bank (farm_id, bank_name, account_name, bsb, account_number)
    values (new.id, new.bank_name, new.account_name, new.bsb, new.account_number)
    on conflict (farm_id) do update
      set bank_name = excluded.bank_name, account_name = excluded.account_name,
          bsb = excluded.bsb, account_number = excluded.account_number;
  end if;
  new.bank_name := null;
  new.account_name := null;
  new.bsb := null;
  new.account_number := null;
  return new;
end;
$$;

drop trigger if exists farms_move_bank_trg on farms;
create trigger farms_move_bank_trg before insert or update on farms
  for each row execute function farms_move_bank();

-- empty the old columns (the trigger above does it for every row it touches; this touches them all once)
update farms set bank_name = bank_name
 where bank_name is not null or account_name is not null or bsb is not null or account_number is not null;

-- ---------------------------------------------------------------------------
-- 2. Inputs and stock for farm workers
-- ---------------------------------------------------------------------------

-- A worker sees the entries that carry no price (use and count). Every entry, with the prices blanked, is read
-- through input_stock_for_worker() below.
drop policy if exists input_stock_select on input_stock;
create policy input_stock_select on input_stock for select
  using ((app_role(farm_id) in ('owner', 'manager', 'bookkeeper')
          or (app_role(farm_id) = 'farm_worker' and move_type in ('use', 'adjust')))
         and deleted_at is null);

drop policy if exists input_stock_insert on input_stock;
create policy input_stock_insert on input_stock for insert
  with check (app_role(farm_id) in ('owner', 'manager', 'bookkeeper')
              or (app_role(farm_id) = 'farm_worker' and move_type in ('use', 'adjust') and unit_cost is null));

drop policy if exists input_stock_update on input_stock;
create policy input_stock_update on input_stock for update
  using (app_role(farm_id) in ('owner', 'manager', 'bookkeeper')
         or (app_role(farm_id) = 'farm_worker' and move_type in ('use', 'adjust')))
  with check (app_role(farm_id) in ('owner', 'manager', 'bookkeeper')
              or (app_role(farm_id) = 'farm_worker' and move_type in ('use', 'adjust') and unit_cost is null));

-- Every entry on the farm with the prices, the supplier and the invoice number left out. Only a farm worker gets
-- rows: everyone else reads the table itself.
create or replace function input_stock_for_worker(p_farm_id uuid)
returns table (
  id uuid, farm_id uuid, season_id uuid, kind text, product text, unit text, move_type text, qty numeric,
  unit_cost numeric, move_date date, supplier text, reference text, notes text, location text,
  created_at timestamptz, updated_at timestamptz, created_by uuid, updated_by uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.farm_id, s.season_id, s.kind, s.product, s.unit, s.move_type, s.qty,
         null::numeric, s.move_date, null::text, null::text, s.notes, s.location,
         s.created_at, s.updated_at, s.created_by, s.updated_by
    from input_stock s
   where s.farm_id = p_farm_id
     and s.deleted_at is null
     and app_role(p_farm_id) = 'farm_worker'
$$;

revoke all on function input_stock_for_worker(uuid) from public;
grant execute on function input_stock_for_worker(uuid) to authenticated;
