-- Price history: the weekly price of a commodity, with optional grade spreads (protein spreads on wheat, for example).
-- Kept on the commodity as a list, like the hay details are, so it travels with the farm's other data.
-- Safe to run more than once.
alter table commodities add column if not exists price_history jsonb;

notify pgrst, 'reload schema';
