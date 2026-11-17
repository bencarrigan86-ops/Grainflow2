-- A sent confirmation of sale is filed with its contract, like a sent vendor declaration or freight order.
-- Safe to run more than once.
alter table sale_documents
  drop constraint if exists sale_documents_kind_check;
alter table sale_documents
  add constraint sale_documents_kind_check
  check (kind in ('contract', 'broker_note', 'vendor_dec', 'freight_order', 'confirmation', 'other'));

notify pgrst, 'reload schema';
