-- Cotton delivered after the contract's delivery finish can take a discount: a list of dollars per bale, one figure for each month
-- late (they do not add up). Empty means none. Kept with the contract's prices, so a field device never receives it. Safe to run
-- more than once. The same row security as the rest of the contract's prices applies.

alter table sale_terms add column if not exists late_discounts jsonb;

notify pgrst, 'reload schema';
