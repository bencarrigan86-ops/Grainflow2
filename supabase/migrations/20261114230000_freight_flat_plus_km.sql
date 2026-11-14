-- Freight orders can be a flat $/t plus so much per tonne per km (eg $15/t + $0.10/t/km x 300 km = $45/t).
-- flat_rate is the flat $/t; rate stays the per-km rate. Optional: only freight orders on that basis have a flat rate.
alter table freight_orders
  add column if not exists flat_rate numeric(12,4);
alter table freight_orders
  drop constraint if exists freight_orders_rate_basis_check;
alter table freight_orders
  add constraint freight_orders_rate_basis_check check (rate_basis in ('per_t', 'per_tkm', 'flat_tkm'));
