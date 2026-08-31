-- Movement photos move out of the row and into object storage.
--
-- Until now a photo was a base64 data URL living inside the movement itself.
-- That is what produced this app's "device storage may be full" alert: a dozen
-- truck photos will exhaust localStorage on their own, and every one of them
-- also has to travel in every sync of the whole farm.
--
-- The bucket is private. Nothing is served by public URL — the app asks for a
-- short-lived signed URL each time it needs to display one, so a photo cannot
-- be shared by copying a link out of the page source.
--
-- Path convention, and the policies below depend on it:
--
--     <farm_id>/<movement_id>/<uuid>.jpg
--
-- The first segment is the farm. That is what makes an object's ownership
-- decidable without a join, which is the only thing storage policies can
-- reasonably do.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'movement-photos',
  'movement-photos',
  false,
  5 * 1024 * 1024,                      -- 5MB; img.js compresses to well under this
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Compare the leading path segment as text rather than casting it to uuid.
-- A malformed object name would make a cast raise, and an erroring policy is
-- indistinguishable from a denying one right up until it is not.
create or replace function app_farm_ids_text()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select farm_id::text
    from farm_users
   where user_id = auth.uid()
     and deleted_at is null
$$;

-- Anyone on the farm may look at its photos — a driver needs to see the ticket
-- they just photographed, and there is nothing commercially sensitive in a
-- picture of a rego plate.
create policy "movement photos are readable by farm members"
on storage.objects for select
to authenticated
using (
  bucket_id = 'movement-photos'
  and (storage.foldername(name))[1] in (select app_farm_ids_text())
);

-- Writing mirrors the movements table: the roles that can log a load can
-- attach a photo to it. Bookkeepers cannot, because they cannot create
-- movements either.
create policy "movement photos are writable by movement-creating roles"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'movement-photos'
  and (storage.foldername(name))[1] in (select app_farm_ids_text())
  and app_role((storage.foldername(name))[1]::uuid)
      in ('owner', 'manager', 'farm_worker', 'driver')
);

create policy "movement photos are replaceable by movement-creating roles"
on storage.objects for update
to authenticated
using (
  bucket_id = 'movement-photos'
  and (storage.foldername(name))[1] in (select app_farm_ids_text())
)
with check (
  bucket_id = 'movement-photos'
  and (storage.foldername(name))[1] in (select app_farm_ids_text())
);

-- Object deletion is allowed where row deletion is not, and deliberately so.
-- The movement row is the record and stays soft-deleted forever; the image is
-- a large attachment with no evidentiary value once its ticket is gone, and
-- keeping orphaned photos is how a storage bill grows for no reason.
create policy "movement photos are removable by owners and managers"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'movement-photos'
  and (storage.foldername(name))[1] in (select app_farm_ids_text())
  and app_role((storage.foldername(name))[1]::uuid) in ('owner', 'manager')
);
