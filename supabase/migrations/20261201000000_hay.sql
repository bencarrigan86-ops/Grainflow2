-- Hay: the kind of bale and its average weight on the commodity, and the bales baled on a paddock.
-- Safe to run more than once.
alter table commodities add column if not exists hay jsonb;
alter table fields add column if not exists bales_baled jsonb;

notify pgrst, 'reload schema';
