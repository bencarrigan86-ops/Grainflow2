-- Spray requests: a job for a spray contractor, with the paddocks to be sprayed, sent as a PDF.
--
-- The scalar columns are what lists and filters need; everything else on the form (the product rates, the checklist
-- answers, the neighbours, the paddocks chosen) is one json document, so a new box on a contractor's form never needs
-- a new column. No prices on a spray request: owner and manager only, like the rest of the farm's paperwork.

create table if not exists spray_jobs (
  id               uuid primary key,
  farm_id          uuid not null references farms(id) on delete cascade,
  season_id        uuid not null references seasons(id) on delete cascade,
  job_no           text,
  contractor       text,
  contractor_email text,
  form             text not null default 'standard' check (form in ('standard', 'aircair')),
  date_required    date,
  status           text not null default 'draft' check (status in ('draft', 'sent', 'done')),
  body             jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  updated_by       uuid,
  deleted_at       timestamptz
);

create index if not exists spray_jobs_farm_season_idx on spray_jobs (farm_id, season_id);

alter table spray_jobs enable row level security;

drop trigger if exists spray_jobs_set_updated_at on spray_jobs;
create trigger spray_jobs_set_updated_at before update on spray_jobs
  for each row execute function set_updated_at();

drop policy if exists spray_jobs_select on spray_jobs;
create policy spray_jobs_select on spray_jobs for select
  using (app_role(farm_id) in ('owner', 'manager') and deleted_at is null);

drop policy if exists spray_jobs_insert on spray_jobs;
create policy spray_jobs_insert on spray_jobs for insert
  with check (app_role(farm_id) in ('owner', 'manager'));

drop policy if exists spray_jobs_update on spray_jobs;
create policy spray_jobs_update on spray_jobs for update
  using (app_role(farm_id) in ('owner', 'manager'))
  with check (app_role(farm_id) in ('owner', 'manager'));

grant select, insert, update on spray_jobs to authenticated;

-- Deleting a spray request: the delete function has to know the new table.
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
    'sale_terms', 'sale_documents', 'record_documents', 'movements', 'movement_legs',
    'movement_photos', 'invoices', 'overheads', 'payables', 'orders', 'freight_orders', 'input_stock', 'spray_jobs'
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
  if not (
    app_role(v_farm) in ('owner', 'manager')
    or v_created = auth.uid()
    or (p_table in ('sale_documents', 'record_documents') and app_role(v_farm) = 'bookkeeper')
  ) then
    raise exception 'not allowed';
  end if;

  execute format('update %I set deleted_at = now() where id = $1 and deleted_at is null', p_table) using p_id;
end;
$$;

revoke all on function soft_delete_row(text, uuid) from public;
grant execute on function soft_delete_row(text, uuid) to authenticated;
