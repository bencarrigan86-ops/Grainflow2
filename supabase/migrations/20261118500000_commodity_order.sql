-- The order the commodities are listed in on every screen: their names, in the order the owner set (optional; stored only once
-- a list has been set). Safe to run more than once.
alter table farms
  add column if not exists commodity_order jsonb;

notify pgrst, 'reload schema';
