-- Hay: the bales on a load (bales and weight, and what it was used for when it was used on the farm).
-- Safe to run more than once.
alter table movements add column if not exists hay_load jsonb;

notify pgrst, 'reload schema';
