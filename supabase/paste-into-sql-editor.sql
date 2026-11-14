-- Paste ALL of this into the Supabase SQL editor and press Run. Safe to run more than once.

-- A farm's own grades for each commodity (optional; stored only when some have been added)
alter table commodities
  add column if not exists custom_grades jsonb;

-- The grades a contract lists, each with a $/t premium or discount (optional; stored only when grades are listed)
alter table sale_terms
  add column if not exists grade_options jsonb;

-- Canola oil: the oil % of a load or a silo, and a contract's base oil and % of price per 1% of oil
-- (optional; stored only when oil is recorded or a contract is priced for it)
alter table movements
  add column if not exists oil_pct numeric(6,2);
alter table storages
  add column if not exists oil_pct numeric(6,2);
alter table sale_terms
  add column if not exists oil_base_pct numeric(6,2),
  add column if not exists oil_adjust_pct numeric(6,2);

-- Off-farm storage: grain held by a third party, with who runs it and what it held at the start of the
-- season by commodity and grade (optional; stored only on a location that is off-farm)
alter table storages
  add column if not exists off_farm jsonb;

-- The receiving site's own ticket number on a load (optional; stored only when one is recorded)
alter table movements
  add column if not exists external_ticket_no text;

-- Accounts payable: bills owed (brokerage, freight, storage, other), and a contract's brokerage $/t.
-- This creates a table, so it is longer than the others; it is safe to run more than once.
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

-- Harvest finished: whether all of a paddock is in (optional; stored only once it is set)
alter table fields
  add column if not exists harvest_done boolean;

-- Hectares still to harvest on a part-harvested paddock (optional; stored only once it is set)
alter table fields
  add column if not exists harvest_ha_left numeric;
