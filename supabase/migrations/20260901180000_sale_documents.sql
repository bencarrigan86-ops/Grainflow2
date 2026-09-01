-- Keeping a copy of the buyer's contract and the broker's note.
--
-- A grower does not write these; they arrive by email and then live in an
-- inbox, which is where they are when somebody needs to check whether the
-- tolerance was 20 tonnes or 5%. The figures get typed into the app; the paper
-- they came from should sit beside them.
--
-- Storage follows the movement-photos migration exactly — private bucket,
-- farm_id as the leading path segment so ownership is decidable without a
-- join, signed URLs on demand — with one deliberate difference.
--
-- A photo of a rego plate is not commercially sensitive and every member of the
-- farm can see one. A purchase contract has the price on it. That puts it on
-- the sale_terms side of the line this schema already draws: owners, managers
-- and bookkeepers, not drivers and farm workers. A driver who could not read a
-- contract in the app but could open the PDF of it would make the whole split
-- decorative.

-- Every policy below is dropped before it is created. `create policy` has no
-- IF NOT EXISTS, so without this the file cannot be run twice — and a
-- migration that fails on a second run is one somebody re-runs at the worst
-- possible moment and then has to unpick by hand.
create table if not exists sale_documents (
  id            uuid primary key,
  farm_id       uuid not null references farms(id) on delete cascade,
  sale_id       uuid not null references sales(id) on delete cascade,
  -- What the document is, so the sale screen can label it rather than showing
  -- a list of filenames.
  kind          text not null default 'contract'
                check (kind in ('contract', 'broker_note', 'other')),
  -- The name as it arrived, because "Contract 672392.pdf" tells the grower
  -- which one it is and the storage path deliberately does not.
  file_name     text,
  storage_path  text not null,
  byte_size     integer,
  uploaded_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  deleted_at    timestamptz
);

create index if not exists sale_documents_farm_sale_idx
  on sale_documents (farm_id, sale_id);

alter table sale_documents enable row level security;

-- The farms this user may see commercial detail for. Distinct from
-- app_farm_ids_text(), which is every farm they belong to in any capacity —
-- that one is right for photos and wrong for contracts.
create or replace function app_commercial_farm_ids_text()
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
     and role in ('owner', 'manager', 'bookkeeper')
$$;

drop policy if exists sale_documents_select on sale_documents;
create policy sale_documents_select on sale_documents for select
  using (app_role(farm_id) in ('owner', 'manager', 'bookkeeper') and deleted_at is null);

drop policy if exists sale_documents_insert on sale_documents;
create policy sale_documents_insert on sale_documents for insert
  with check (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'));

drop policy if exists sale_documents_update on sale_documents;
create policy sale_documents_update on sale_documents for update
  using (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'))
  with check (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'));

-- ---------------------------------------------------------------------------
-- The bucket
--
-- 20MB rather than the photos' 5MB: the Network Grains contract in hand is
-- 1.8MB and a scanned one will be larger. PDFs and images both, because a
-- broker's note often arrives as a photograph of a piece of paper.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sale-documents',
  'sale-documents',
  false,
  20 * 1024 * 1024,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

drop policy if exists "sale documents are readable by owners, managers and bookkeepers" on storage.objects;
create policy "sale documents are readable by owners, managers and bookkeepers"
on storage.objects for select
to authenticated
using (
  bucket_id = 'sale-documents'
  and (storage.foldername(name))[1] in (select app_commercial_farm_ids_text())
);

drop policy if exists "sale documents are written by owners, managers and bookkeepers" on storage.objects;
create policy "sale documents are written by owners, managers and bookkeepers"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'sale-documents'
  and (storage.foldername(name))[1] in (select app_commercial_farm_ids_text())
);

drop policy if exists "sale documents are removed by owners, managers and bookkeepers" on storage.objects;
create policy "sale documents are removed by owners, managers and bookkeepers"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'sale-documents'
  and (storage.foldername(name))[1] in (select app_commercial_farm_ids_text())
);
