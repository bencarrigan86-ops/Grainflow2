-- Attach files to orders, invoices (receivables) and bills (payables).
--
-- One table for all three, so a buyer's order, a copy of an invoice, a remittance or a supplier's bill can sit beside
-- the record it belongs to. The files live in the same private 'sale-documents' bucket as contracts (farm_id leading
-- the path), so the existing storage policies already cover them.
--
-- Who can see a document follows the record it is attached to. Orders, invoices and bills are all visible to the owner,
-- the manager and the bookkeeper (see 20261114200000_manager_sees_money.sql); drivers and farm workers see none.

create table if not exists record_documents (
  id            uuid primary key,
  farm_id       uuid not null references farms(id) on delete cascade,
  parent_type   text not null check (parent_type in ('order', 'invoice', 'payable')),
  parent_id     uuid not null,
  kind          text not null default 'other'
                check (kind in ('order', 'invoice', 'remittance', 'bill', 'proof_of_delivery', 'receipt', 'other')),
  file_name     text,
  storage_path  text not null,
  byte_size     integer,
  uploaded_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  updated_by    uuid,
  deleted_at    timestamptz
);

create index if not exists record_documents_parent_idx on record_documents (farm_id, parent_type, parent_id);

alter table record_documents enable row level security;

drop trigger if exists record_documents_set_updated_at on record_documents;
create trigger record_documents_set_updated_at before update on record_documents
  for each row execute function set_updated_at();

drop policy if exists record_documents_select on record_documents;
create policy record_documents_select on record_documents for select
  using (deleted_at is null and app_role(farm_id) in ('owner', 'manager', 'bookkeeper'));

drop policy if exists record_documents_insert on record_documents;
create policy record_documents_insert on record_documents for insert
  with check (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'));

drop policy if exists record_documents_update on record_documents;
create policy record_documents_update on record_documents for update
  using (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'))
  with check (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'));

grant select, insert, update on record_documents to authenticated;

-- Deleting a document: the delete function has to know the new table, and a bookkeeper (who may attach and remove
-- documents) is allowed to remove one of the two document tables' rows even though they did not create it.
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
    'movement_photos', 'invoices', 'overheads', 'payables', 'orders', 'freight_orders'
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
