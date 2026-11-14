-- Recently deleted: see what was deleted lately and bring it back.
--
-- Deleting in the app only stamps deleted_at; the row stays in the database. The ordinary read policies hide
-- stamped rows, so the app cannot list them itself. These two functions do it, applying the same rules as the
-- delete function:
--
--   list_deleted(farm, days)   what was deleted in the last `days` days, with a name and a line of detail
--   restore_row(table, id)     bring one back, with whatever was deleted with it
--
-- Only owners and managers may use them, and only owners may see or restore contracts, invoices and bills,
-- which carry prices and amounts. Nothing is returned beyond a name, a short detail and when it was deleted.
--
-- Restoring a contract brings back its terms, documents and orders; a paddock its agronomy; a load its legs and
-- photo. "With it" means deleted within five minutes of the parent, so something deleted separately, earlier,
-- stays deleted. A load or invoice whose number has since been used by another gets the next free number. Orders
-- cannot be restored while their contract is deleted, and nothing can be restored into a season that was deleted.
--
-- Idempotent: safe to run again.

create or replace function list_deleted(p_farm uuid, p_days integer default 60)
returns table (tbl text, id uuid, deleted_at timestamptz, season text, label text, detail text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_since timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  v_role := app_role(p_farm);
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'not allowed';
  end if;
  v_since := now() - make_interval(days => greatest(1, least(coalesce(p_days, 60), 365)));

  return query
  select 'commodities'::text, t.id, t.deleted_at, (select s.label from seasons s where s.id = t.season_id),
         t.name, null::text
    from commodities t where t.farm_id = p_farm and t.deleted_at >= v_since
  union all
  select 'fields', t.id, t.deleted_at, (select s.label from seasons s where s.id = t.season_id),
         t.name, trim(to_char(t.area_ha, 'FM999999990.##')) || ' ha'
    from fields t where t.farm_id = p_farm and t.deleted_at >= v_since
  union all
  select 'storages', t.id, t.deleted_at, (select s.label from seasons s where s.id = t.season_id),
         t.name, t.kind
    from storages t where t.farm_id = p_farm and t.deleted_at >= v_since
  union all
  select 'movements', t.id, t.deleted_at, (select s.label from seasons s where s.id = t.season_id),
         'Ticket #' || coalesce(t.ticket_no::text, '?'),
         concat_ws(' · ', t.move_date::text, trim(to_char(t.tons, 'FM999999990.##')) || ' t')
    from movements t where t.farm_id = p_farm and t.deleted_at >= v_since
  union all
  select 'orders', t.id, t.deleted_at, (select s.label from seasons s where s.id = t.season_id),
         coalesce('Order #' || nullif(t.order_no, ''), 'Order'),
         trim(to_char(t.tons, 'FM999999990.##')) || ' t'
    from orders t where t.farm_id = p_farm and t.deleted_at >= v_since
  union all
  select 'sales', t.id, t.deleted_at, (select s.label from seasons s where s.id = t.season_id),
         concat_ws(' ', coalesce(nullif(t.buyer, ''), 'Contract'), '#' || nullif(t.contract_no, '')),
         trim(to_char(t.tonnes, 'FM999999990.##')) || ' t'
    from sales t where v_role = 'owner' and t.farm_id = p_farm and t.deleted_at >= v_since
  union all
  select 'invoices', t.id, t.deleted_at, (select s.label from seasons s where s.id = t.season_id),
         'Invoice #' || coalesce(t.invoice_no::text, '?'), t.status
    from invoices t where v_role = 'owner' and t.farm_id = p_farm and t.deleted_at >= v_since
  union all
  select 'payables', t.id, t.deleted_at, (select s.label from seasons s where s.id = t.season_id),
         coalesce(nullif(t.supplier, ''), t.kind), t.kind
    from payables t where v_role = 'owner' and t.farm_id = p_farm and t.deleted_at >= v_since
  order by 3 desc;
end;
$$;

revoke all on function list_deleted(uuid, integer) from public;
grant execute on function list_deleted(uuid, integer) to authenticated;

create or replace function restore_row(p_table text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  j jsonb;
  v_farm uuid;
  v_role text;
  v_deleted timestamptz;
  v_season uuid;
  v_from timestamptz;
  v_to timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if p_table not in ('commodities', 'fields', 'storages', 'movements', 'orders', 'sales', 'invoices', 'payables') then
    raise exception 'cannot restore from %', p_table;
  end if;

  execute format('select to_jsonb(t) from %I t where t.id = $1', p_table) into j using p_id;
  if j is null then
    raise exception 'not found';
  end if;

  v_farm := nullif(j->>'farm_id', '')::uuid;
  v_role := case when v_farm is null then null else app_role(v_farm) end;
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'not allowed';
  end if;
  if p_table in ('sales', 'invoices', 'payables') and v_role <> 'owner' then
    raise exception 'not allowed';
  end if;

  v_deleted := nullif(j->>'deleted_at', '')::timestamptz;
  if v_deleted is null then
    return;                                   -- not deleted: nothing to do
  end if;

  v_season := nullif(j->>'season_id', '')::uuid;
  if v_season is not null and exists (select 1 from seasons s where s.id = v_season and s.deleted_at is not null) then
    raise exception 'It belongs to a season that was deleted';
  end if;
  if p_table = 'orders' and exists (
    select 1 from sales s where s.id = nullif(j->>'sale_id', '')::uuid and s.deleted_at is not null
  ) then
    raise exception 'Restore its contract first';
  end if;

  v_from := v_deleted - interval '5 minutes';
  v_to := v_deleted + interval '5 minutes';

  if p_table = 'movements' then
    begin
      update movements set deleted_at = null where id = p_id;
    exception when unique_violation then
      update movements set deleted_at = null,
        ticket_no = (select coalesce(max(m.ticket_no), 0) + 1 from movements m where m.farm_id = v_farm)
        where id = p_id;
    end;
    update movement_legs set deleted_at = null where movement_id = p_id and deleted_at between v_from and v_to;
    update movement_photos set deleted_at = null where movement_id = p_id and deleted_at between v_from and v_to;
  elsif p_table = 'invoices' then
    begin
      update invoices set deleted_at = null where id = p_id;
    exception when unique_violation then
      update invoices set deleted_at = null,
        invoice_no = (select coalesce(max(i.invoice_no), 0) + 1 from invoices i where i.farm_id = v_farm)
        where id = p_id;
    end;
  elsif p_table = 'sales' then
    update sales set deleted_at = null where id = p_id;
    update sale_terms set deleted_at = null where sale_id = p_id and deleted_at between v_from and v_to;
    update sale_documents set deleted_at = null where sale_id = p_id and deleted_at between v_from and v_to;
    update orders set deleted_at = null where sale_id = p_id and deleted_at between v_from and v_to;
  elsif p_table = 'fields' then
    update fields set deleted_at = null where id = p_id;
    update field_agronomy set deleted_at = null where field_id = p_id and deleted_at between v_from and v_to;
  else
    execute format('update %I set deleted_at = null where id = $1', p_table) using p_id;
  end if;
end;
$$;

revoke all on function restore_row(text, uuid) from public;
grant execute on function restore_row(text, uuid) to authenticated;
