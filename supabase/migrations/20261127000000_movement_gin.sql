-- A cotton ginning run is kept on its movement: modules, bales, lint and seed weights, the gin's rates and levies.
-- Safe to run more than once.
alter table movements add column if not exists gin jsonb;

notify pgrst, 'reload schema';
