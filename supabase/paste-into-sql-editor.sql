-- Paste ALL of this into the Supabase SQL editor and press Run.
-- It adds everything the last few app updates need. Safe to run more than once.

-- 1. Grain quality on silos (crop year, grade, moisture, protein, screenings, test weight, falling number)
alter table storages
  add column if not exists crop_year         text,
  add column if not exists grade             text,
  add column if not exists moisture_pct      numeric(6,2),
  add column if not exists protein_pct       numeric(6,2),
  add column if not exists screenings_pct    numeric(6,2),
  add column if not exists test_weight_kg_hl numeric(6,2),
  add column if not exists falling_number    numeric(7,1);

-- 2. Quality on each truck load, the freight platform's movement number, and notes on silos
alter table movements
  add column if not exists grade             text,
  add column if not exists moisture_pct      numeric(6,2),
  add column if not exists protein_pct       numeric(6,2),
  add column if not exists screenings_pct    numeric(6,2),
  add column if not exists test_weight_kg_hl numeric(6,2),
  add column if not exists falling_number    numeric(7,1),
  add column if not exists source_ref        text;

alter table storages
  add column if not exists notes text;

create index if not exists movements_source_ref_idx on movements (farm_id, source_ref)
  where source_ref is not null;
