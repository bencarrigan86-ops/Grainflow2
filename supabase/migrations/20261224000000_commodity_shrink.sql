-- Shrink in silos: the percentage of the grain going from a paddock into a silo that is lost (normally 0.7%), one figure per
-- commodity. Empty means no shrink. Safe to run more than once. The same row security as the rest of the commodity applies.

alter table commodities add column if not exists shrink_pct numeric;

notify pgrst, 'reload schema';
