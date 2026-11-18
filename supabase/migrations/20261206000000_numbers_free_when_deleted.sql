-- A deleted ticket or invoice no longer holds its number.
--
-- Deleting a record only stamps deleted_at: the row stays, and the plain unique constraints on (farm_id, ticket_no) and
-- (farm_id, invoice_no) kept the number of a deleted row for ever. A farm that is reset, or has a season imported or the sample
-- loaded over it, brings in new records that reuse the numbers of the old ones (ticket 1001, invoice 1). The server refused them
-- ("duplicate key value violates unique constraint movements_farm_id_ticket_no_key"), the phone stopped sending, and its changes
-- stayed waiting.
--
-- The numbers must still be unique among the records that are live, so the constraints become unique indexes over the rows
-- that are not deleted. (Restoring a deleted record that has lost its number already renumbers it: see recently_deleted.)

alter table movements drop constraint if exists movements_farm_id_ticket_no_key;
create unique index if not exists movements_farm_ticket_no_live on movements (farm_id, ticket_no) where deleted_at is null;

alter table invoices drop constraint if exists invoices_farm_id_invoice_no_key;
create unique index if not exists invoices_farm_invoice_no_live on invoices (farm_id, invoice_no) where deleted_at is null;
