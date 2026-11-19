-- A report sent by someone who is not the owner still goes through, but support cannot look at the farm until the owner
-- allows it. The report is marked "wants support" so the owner can be told it is waiting.
--
-- The owner is not given the reports themselves (they carry other people's words and error details). The owner only asks
-- how many are waiting, and a report stops waiting once the owner has given support access after it was sent.

alter table problem_reports add column if not exists wants_support boolean not null default false;

create or replace function support_requests_waiting(p_farm_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case when auth.uid() is not null and app_role(p_farm_id) = 'owner' then
    (select count(*)::int from problem_reports r
      where r.farm_id = p_farm_id and r.wants_support
        and r.created_at > coalesce((select max(l.at) from support_access_log l where l.farm_id = p_farm_id and l.action = 'granted'), 'epoch'::timestamptz))
  else 0 end;
$$;

revoke all on function support_requests_waiting(uuid) from public;
grant execute on function support_requests_waiting(uuid) to authenticated;

notify pgrst, 'reload schema';
