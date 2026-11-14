-- A paddock's outline on the farm map: rings of [longitude, latitude] points, from a shapefile import.
-- Optional: a paddock never mapped has none.
alter table fields
  add column if not exists boundary jsonb;
