-- The buyer's order number, typed on a freight order (for a job with no grain order, or to override the grain order's).
-- Optional; stored only once one has been entered. Safe to run more than once.
alter table freight_orders
  add column if not exists buyer_order_no text;

notify pgrst, 'reload schema';
