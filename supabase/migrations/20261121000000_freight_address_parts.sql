-- A freight order's Deliver from and Deliver to addresses, kept in parts (line 1, line 2, town, state, postcode) beside the
-- one line each already has. Optional; stored only once an address has been entered in parts. Safe to run more than once.
alter table freight_orders
  add column if not exists pickup_parts jsonb;
alter table freight_orders
  add column if not exists deliver_to_parts jsonb;

notify pgrst, 'reload schema';
