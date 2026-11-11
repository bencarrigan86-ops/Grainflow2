-- Running samples of a silo, by tonnes from the bottom.
--
-- Grain is sampled after harvest as it sits in the silo, not truck by truck: "the first
-- 800 t is APH1, 11.5% protein; the next 600 t is AUH2, 10.2%". This holds those
-- stretches, bottom first, with the date the samples were taken:
--
--   { "asOf": "2026-11-12",
--     "bands": [ { "tons": 800, "grade": "APH1", "proteinPct": 11.5, "moisturePct": 11.0,
--                  "screeningsPct": 1.2, "testWeightKgHl": 79.5, "fallingNumber": 400 }, ... ] }
--
-- They replace what the individual loads say for the grain they cover, so the silo can show
-- the grades in it and the outload predictor can say what each truck will carry. Loads
-- tipped in after the date keep their own grade.
--
-- Optional: nothing is stored unless a band is described. Idempotent.

alter table storages
  add column if not exists grade_bands jsonb;
