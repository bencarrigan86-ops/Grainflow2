-- The farm or site a silo, bunker or tally storage sits on (a paddock already has its Farm). Optional: empty means not said.
-- Safe to run more than once. The same row security as the rest of the storage applies.

alter table storages add column if not exists property text;

notify pgrst, 'reload schema';
