-- What is in a silo: the grain's quality, not just its quantity.
--
-- A storage already says which commodity it holds and how many tonnes. What a
-- buyer asks about before anything else is what it is: the crop year, the grade
-- it has been classed as, and the measurements that grade rests on. Until now
-- those lived in the grower's head or on a sticker on the silo, which is fine
-- until a load has to be matched to a contract and the question is "which silo
-- is the APH1 at eleven percent protein".
--
-- Seven plain columns, all optional, all on storages:
--
--   crop_year           as the grower writes it, "2026/27". Text, because it is
--                       a label and the contracts' own crop_year is text too.
--   grade               "APH1", "BAR1". Text; the grades are the buyer's.
--   moisture_pct        percent
--   protein_pct         percent
--   screenings_pct      percent
--   test_weight_kg_hl   kilograms per hectolitre — what the grain weighs, as
--                       measured. NOT the same column as test_weight above,
--                       which is the density in tonnes per cubic metre used to
--                       turn a measured volume into tonnes. 78 kg/hL is 0.78 t/m3,
--                       but one is a result and the other is a setting.
--   falling_number      seconds
--
-- Nothing here is restricted: a field device reads storages already, and a
-- truck driver deciding which silo to unload into is exactly who wants to know.
--
-- Idempotent, like the others: running it twice is harmless.

alter table storages
  add column if not exists crop_year         text,
  add column if not exists grade             text,
  add column if not exists moisture_pct      numeric(6,2),
  add column if not exists protein_pct       numeric(6,2),
  add column if not exists screenings_pct    numeric(6,2),
  add column if not exists test_weight_kg_hl numeric(6,2),
  add column if not exists falling_number    numeric(7,1);
