-- Follow-ups to the vendor declaration.
--
-- 1. our_ref: the farm's own number for a contract, beside the buyer's contract number (contract_no).
-- 2. sale_documents.kind now allows 'vendor_dec': a declaration that was sent, kept with the contract.
-- 3. user_signatures: a person's handwritten signature, kept as the strokes it was drawn with. It belongs to the
--    person, not the farm: only that person can read or write their own row, and it goes with them to any farm.

alter table sales
  add column if not exists our_ref text;

alter table sale_documents
  drop constraint if exists sale_documents_kind_check;
alter table sale_documents
  add constraint sale_documents_kind_check
  check (kind in ('contract', 'broker_note', 'vendor_dec', 'other'));

create table if not exists user_signatures (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  strokes      text not null,
  signer_name  text,
  updated_at   timestamptz not null default now()
);

alter table user_signatures enable row level security;

drop policy if exists user_signatures_select on user_signatures;
create policy user_signatures_select on user_signatures
  for select to authenticated using (user_id = auth.uid());

drop policy if exists user_signatures_insert on user_signatures;
create policy user_signatures_insert on user_signatures
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists user_signatures_update on user_signatures;
create policy user_signatures_update on user_signatures
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists user_signatures_delete on user_signatures;
create policy user_signatures_delete on user_signatures
  for delete to authenticated using (user_id = auth.uid());
