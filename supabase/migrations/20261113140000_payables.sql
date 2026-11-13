-- Accounts payable: what the farm owes. Brokerage, freight invoices, storage at third-party sites, and
-- anything else. One row per bill.
--
--   kind        brokerage | freight | storage | other
--   supplier    who the bill is from (the broker, the carrier, GrainCorp ...)
--   reference   their invoice number
--   amount      the bill ex GST; gst is the GST on it
--   sale_id     the contract it is for, if any (brokerage and freight usually are)
--   storage_id  the off-farm location it is for, if any (storage fees)
--   tons, rate  the tonnes and $/t it was worked out on, when it was
--   status      unpaid | paid, with paid_date
--
-- Owners and bookkeepers only, like invoices: what the farm owes is commercial detail.
-- Optional columns and tables only: nothing is stored until a bill is recorded. Idempotent.

create table if not exists payables (
  id            uuid primary key,
  farm_id       uuid not null references farms(id) on delete cascade,
  season_id     uuid not null references seasons(id) on delete cascade,
  kind          text not null default 'other' check (kind in ('brokerage', 'freight', 'storage', 'other')),
  supplier      text,
  reference     text,
  invoice_date  date,
  due_date      date,
  amount        numeric(14,2) not null default 0,
  gst           numeric(14,2) not null default 0,
  sale_id       uuid references sales(id) on delete set null,
  storage_id    uuid references storages(id) on delete set null,
  tons          numeric(14,3),
  rate          numeric(12,4),
  status        text not null default 'unpaid' check (status in ('unpaid', 'paid')),
  paid_date     date,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  deleted_at    timestamptz
);

create index if not exists payables_farm_season_idx on payables (farm_id, season_id);

alter table payables enable row level security;

drop trigger if exists payables_set_updated_at on payables;
create trigger payables_set_updated_at before update on payables
  for each row execute function set_updated_at();

drop policy if exists payables_select on payables;
create policy payables_select on payables for select
  using (app_role(farm_id) in ('owner', 'bookkeeper') and deleted_at is null);

drop policy if exists payables_insert on payables;
create policy payables_insert on payables for insert
  with check (app_role(farm_id) in ('owner', 'bookkeeper'));

drop policy if exists payables_update on payables;
create policy payables_update on payables for update
  using (app_role(farm_id) in ('owner', 'bookkeeper'))
  with check (app_role(farm_id) in ('owner', 'bookkeeper'));

grant select, insert, update on payables to authenticated;

-- A contract's brokerage, in $/t, charged on the tonnes delivered. With the other figures that move
-- a contract's value it sits in sale_terms, so a field device never receives it.
alter table sale_terms
  add column if not exists brokerage_rate numeric(10,2);

-- Deleting a bill: the delete function has to know the new table.
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
    'sale_terms', 'sale_documents', 'movements', 'movement_legs',
    'movement_photos', 'invoices', 'overheads', 'payables'
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
  if not (app_role(v_farm) in ('owner', 'manager') or v_created = auth.uid()) then
    raise exception 'not allowed';
  end if;

  execute format('update %I set deleted_at = now() where id = $1 and deleted_at is null', p_table) using p_id;
end;
$$;

revoke all on function soft_delete_row(text, uuid) from public;
grant execute on function soft_delete_row(text, uuid) to authenticated;
