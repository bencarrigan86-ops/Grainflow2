-- Audit history: who changed what, and when.
--
-- The database writes it, not the app, so nothing the app does can skip it and nothing a person does can edit it. A row is written
-- when a contract, load, invoice, bill, order, commodity, paddock, silo or the like is added, changed, deleted or restored. A change
-- keeps the column, what it was and what it became. Owners, managers and bookkeepers can read it; nobody can write or delete it.
-- Safe to run more than once.

create table if not exists audit_log (
  id          bigint generated always as identity primary key,
  farm_id     uuid not null references farms(id) on delete cascade,
  at          timestamptz not null default now(),
  user_id     uuid,
  user_email  text,
  user_role   text,
  table_name  text not null,
  row_id      uuid,
  action      text not null check (action in ('added', 'changed', 'deleted', 'restored')),
  label       text,
  changes     jsonb
);

create index if not exists audit_log_farm_at_idx on audit_log (farm_id, at desc);

alter table audit_log enable row level security;

drop policy if exists audit_log_select on audit_log;
create policy audit_log_select on audit_log for select
  using (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'));

-- no insert, update or delete policy: only the trigger below writes to it
revoke all on audit_log from public;
grant select on audit_log to authenticated;

-- what to call the record in the list: a contract by its buyer and number, a load by its ticket, and so on
create or replace function audit_label(p_table text, r jsonb)
returns text
language sql
stable
set search_path = public
as $$
  select case p_table
    when 'sales' then concat_ws(' ', coalesce(nullif(r->>'buyer', ''), 'Contract'), '#' || nullif(r->>'contract_no', ''))
    when 'sale_terms' then (select concat_ws(' ', coalesce(nullif(s.buyer, ''), 'Contract'), '#' || nullif(s.contract_no, ''), 'price and terms')
                              from sales s where s.id = (r->>'sale_id')::uuid)
    when 'movements' then 'Ticket #' || coalesce(r->>'ticket_no', '?')
    when 'invoices' then 'Invoice #' || coalesce(r->>'invoice_no', '?')
    when 'payables' then coalesce(nullif(r->>'supplier', ''), nullif(r->>'kind', ''), 'Bill')
    when 'orders' then coalesce('Order #' || nullif(r->>'order_no', ''), 'Order')
    when 'freight_orders' then coalesce('Freight order ' || nullif(r->>'freight_no', ''), 'Freight order')
    when 'spray_jobs' then coalesce('Spray request ' || nullif(r->>'job_no', ''), 'Spray request')
    when 'overheads' then 'Overheads'
    else coalesce(nullif(r->>'name', ''), nullif(r->>'product', ''), nullif(r->>'title', ''))
  end
$$;

create or replace function audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n   jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  o   jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  act text;
  ch  jsonb := '{}'::jsonb;
  k   text;
  nv  jsonb;
  ov  jsonb;
  fid uuid;
begin
  fid := coalesce((n->>'farm_id')::uuid, (o->>'farm_id')::uuid);
  if fid is null then return null; end if;

  if tg_op = 'INSERT' then act := 'added';
  elsif tg_op = 'DELETE' then act := 'deleted';
  elsif o->>'deleted_at' is null and n->>'deleted_at' is not null then act := 'deleted';
  elsif o->>'deleted_at' is not null and n->>'deleted_at' is null then act := 'restored';
  else act := 'changed';
  end if;

  if tg_op = 'UPDATE' and act = 'changed' then
    for k in select jsonb_object_keys(n) loop
      continue when k in ('updated_at', 'updated_by', 'created_at', 'created_by', 'deleted_at');
      nv := n->k;
      ov := o->k;
      if nv is distinct from ov then
        -- a long value (a list of lines, a document body) is noted as edited rather than copied
        if length(coalesce(nv::text, '')) > 200 or length(coalesce(ov::text, '')) > 200 then
          ch := ch || jsonb_build_object(k, jsonb_build_array('...', '...'));
        else
          ch := ch || jsonb_build_object(k, jsonb_build_array(ov, nv));
        end if;
      end if;
    end loop;
    -- a save that changed nothing a person would care about (the sync sends rows again) is not an entry
    if ch = '{}'::jsonb then return null; end if;
  end if;

  insert into audit_log (farm_id, user_id, user_email, user_role, table_name, row_id, action, label, changes)
  values (fid, auth.uid(), auth.jwt() ->> 'email', app_role(fid), tg_table_name,
          coalesce((n->>'id')::uuid, (o->>'id')::uuid), act,
          audit_label(tg_table_name, coalesce(n, o)), nullif(ch, '{}'::jsonb));
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'sales', 'sale_terms', 'movements', 'invoices', 'payables', 'orders', 'freight_orders',
    'commodities', 'fields', 'storages', 'input_stock', 'spray_jobs', 'record_documents', 'overheads'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on %I', 'audit_' || t, t);
      execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row()', 'audit_' || t, t);
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
