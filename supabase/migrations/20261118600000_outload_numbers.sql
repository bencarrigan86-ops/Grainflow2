-- Outload numbers: the number a truck is given to quote at a third-party site (the site keeps it on its ticket, and the delivery
-- data comes back against it). Safe to run more than once.
--
-- A number is the season (two digits), the person's series digit and that person's own count: 26 1 001 is 261001. Each person on
-- the farm has a series digit of their own (1 to 9), so two phones that are both out of signal can never give out the same number.
--
-- 1. each member's series digit, unique among the members still on the farm, handed out automatically
-- 2. the number on the load (optional column)
-- 3. the farm's saved import formats (optional column)

alter table farm_users
  add column if not exists outload_series smallint;

alter table farm_users
  drop constraint if exists farm_users_outload_series_range;
alter table farm_users
  add constraint farm_users_outload_series_range check (outload_series is null or outload_series between 1 and 9);

-- one digit, one person: while somebody is on the farm their digit is theirs alone
create unique index if not exists farm_users_outload_series_unique
  on farm_users (farm_id, outload_series)
  where outload_series is not null and deleted_at is null;

-- the lowest digit nobody on the farm is using, for people who write loads (not the bookkeeper or support)
create or replace function assign_outload_series()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_digit smallint;
begin
  if new.deleted_at is not null or new.role not in ('owner', 'manager', 'farm_worker', 'driver') then
    return new;
  end if;
  -- keep a digit that is still free (a person brought back onto the farm keeps theirs unless somebody has taken it since)
  if new.outload_series is not null
     and not exists (
       select 1 from farm_users f
       where f.farm_id = new.farm_id and f.outload_series = new.outload_series
         and f.deleted_at is null and f.id <> new.id
     ) then
    return new;
  end if;
  select d into v_digit
  from generate_series(1, 9) as d
  where not exists (
    select 1 from farm_users f
    where f.farm_id = new.farm_id and f.outload_series = d and f.deleted_at is null and f.id <> new.id
  )
  order by d
  limit 1;
  new.outload_series := v_digit;   -- null when all nine are taken: the owner is told, and can free one
  return new;
end;
$$;

drop trigger if exists farm_users_assign_outload_series on farm_users;
create trigger farm_users_assign_outload_series
  before insert or update of deleted_at, role on farm_users
  for each row execute function assign_outload_series();

-- the people already on the farms, the oldest first (the owner first of all)
do $$
declare
  r record;
begin
  for r in
    select id from farm_users
    where outload_series is null and deleted_at is null and role in ('owner', 'manager', 'farm_worker', 'driver')
    order by farm_id, (role = 'owner') desc, created_at, id
  loop
    update farm_users set role = role where id = r.id;   -- fires the trigger, which picks the digit
  end loop;
end;
$$;

-- the number a truck quotes, on the load
alter table movements
  add column if not exists outload_no text;

create index if not exists movements_outload_no_idx on movements (farm_id, outload_no) where outload_no is not null;

-- the farm's saved layouts for the files that come back from a site (which column is the weight, which is moisture, ...)
alter table farms
  add column if not exists import_formats jsonb;

notify pgrst, 'reload schema';
