-- What was on each truck, and a place to write things down about a silo.
--
-- Two small additions that belong together.
--
-- Load quality
--
-- A silo's contents are not one thing. They are the loads that went into it, one
-- after another, and each load may have been a different grade, protein or
-- moisture. To say what will come out of a silo when it is emptied — and in which
-- order — the quality of each load has to be on the load. These are the same six
-- measurements the silo itself can carry (see 20261111120000_storage_quality),
-- recorded against the movement that put the grain there:
--
--   grade, moisture_pct, protein_pct, screenings_pct, test_weight_kg_hl,
--   falling_number
--
-- All optional: most loads will have none recorded and the outload prediction
-- says so rather than guessing.
--
-- test_weight_kg_hl is the measured weight of the grain in kilograms per
-- hectolitre, as on storages — not a density setting.
--
-- Silo notes
--
-- A free-text note on a storage: which bin the auger sticks on, that the base is
-- being kept for seed, that the fan was off over the weekend. Commodities and
-- fields already have one; storages did not.
--
-- Idempotent, like the others: running it twice is harmless.

alter table movements
  add column if not exists grade             text,
  add column if not exists moisture_pct      numeric(6,2),
  add column if not exists protein_pct       numeric(6,2),
  add column if not exists screenings_pct    numeric(6,2),
  add column if not exists test_weight_kg_hl numeric(6,2),
  add column if not exists falling_number    numeric(7,1);

alter table storages
  add column if not exists notes text;

-- The other system's movement number
--
-- Loads brought in from the freight platform's export carry that platform's own
-- movement number (M…), so a load here can be found there, and the other way
-- round, by one unique id. Until now it was only written into the notes.

alter table movements
  add column if not exists source_ref text;

create index if not exists movements_source_ref_idx on movements (farm_id, source_ref)
  where source_ref is not null;
