-- Fumigations of a silo, bunker or shed: a record, newest first when shown.
--
--   [ { "id": "f2026-11-10-ab12c", "date": "2026-11-10", "product": "Phosphine", "days": 14,
--       "endsOn": "2026-11-24", "notes": "" }, ... ]
--
-- "endsOn" is the first day the grain is clear to load out (the date plus the withholding days, or typed over).
-- Optional: nothing is stored unless a fumigation is recorded. Safe to run more than once.
alter table storages
  add column if not exists fumigations jsonb;

notify pgrst, 'reload schema';
