-- Canola paid for its oil.
--
-- Oil content is measured on each load off the weighbridge sample, and on a silo's grain. A contract
-- can price for it: a base oil level (42% under the AOF terms) and the % of the price that moves for
-- every 1% of oil above or below it (1.5% under AOF). A load at 44% oil on a $700 contract is paid
-- 700 x 1.5% x 2 = $21/t over.
--
--   movements.oil_pct, storages.oil_pct       the oil, as a percentage
--   sale_terms.oil_base_pct                   the base oil level
--   sale_terms.oil_adjust_pct                 % of price per 1% of oil
--
-- With the other figures that move a contract's value, the terms are in sale_terms, so a field
-- device never receives them.
--
-- Optional: nothing is stored until oil is recorded or a contract is priced for it. Idempotent.

alter table movements
  add column if not exists oil_pct numeric(6,2);
alter table storages
  add column if not exists oil_pct numeric(6,2);
alter table sale_terms
  add column if not exists oil_base_pct numeric(6,2),
  add column if not exists oil_adjust_pct numeric(6,2);
