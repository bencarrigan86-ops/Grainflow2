-- Schema-qualify the helper calls in the storage policies.
--
-- The previous migration called app_role() and app_farm_ids_text() unqualified.
-- Policies on storage.objects are evaluated in the storage schema's context,
-- and public is not reliably on the search path there — so the call can fail to
-- resolve, the policy raises instead of returning false, and every upload is
-- refused with a message that looks like a permissions problem rather than a
-- missing function.
--
-- Setting search_path inside the functions does not help: that governs what the
-- function body can see once it is running, not whether the caller can find the
-- function in the first place.

drop policy if exists "movement photos are readable by farm members" on storage.objects;
drop policy if exists "movement photos are writable by movement-creating roles" on storage.objects;
drop policy if exists "movement photos are replaceable by movement-creating roles" on storage.objects;
drop policy if exists "movement photos are removable by owners and managers" on storage.objects;

create policy "movement photos are readable by farm members"
on storage.objects for select
to authenticated
using (
  bucket_id = 'movement-photos'
  and (storage.foldername(name))[1] in (select public.app_farm_ids_text())
);

create policy "movement photos are writable by movement-creating roles"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'movement-photos'
  and (storage.foldername(name))[1] in (select public.app_farm_ids_text())
  and public.app_role((storage.foldername(name))[1]::uuid)
      in ('owner', 'manager', 'farm_worker', 'driver')
);

create policy "movement photos are replaceable by movement-creating roles"
on storage.objects for update
to authenticated
using (
  bucket_id = 'movement-photos'
  and (storage.foldername(name))[1] in (select public.app_farm_ids_text())
)
with check (
  bucket_id = 'movement-photos'
  and (storage.foldername(name))[1] in (select public.app_farm_ids_text())
);

create policy "movement photos are removable by owners and managers"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'movement-photos'
  and (storage.foldername(name))[1] in (select public.app_farm_ids_text())
  and public.app_role((storage.foldername(name))[1]::uuid) in ('owner', 'manager')
);

-- The authenticated role also needs to be able to call them from that context.
grant execute on function public.app_farm_ids_text() to authenticated;
grant execute on function public.app_role(uuid) to authenticated;
