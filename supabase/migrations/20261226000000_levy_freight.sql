-- The freight taken off a contract's price to get the farm-gate value that levies are charged on ($ per tonne).
-- Sold ex farm there is none; sold delivered, the buyer works it out, and it is not always the real freight rate.
-- Optional: left empty, the contract's own freight is used. Lives in sale_terms with the other money terms,
-- which a field device never receives.
alter table sale_terms
  add column if not exists levy_freight numeric;

notify pgrst, 'reload schema';
