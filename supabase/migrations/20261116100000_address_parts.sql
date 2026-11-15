-- An address in its parts: line 1, line 2, town, state and postcode (optional; stored only once an address has been split).
-- The joined one-line address stays in its old column, which is what the documents print. Safe to run more than once.
alter table farms
  add column if not exists address_parts jsonb;

alter table sale_terms
  add column if not exists buyer_address_parts jsonb;
