-- The time a load was loaded or left, as 24 hour text such as 14:30 (optional; stored only when a time is recorded).
-- Used by the load report. Safe to run more than once.
alter table movements
  add column if not exists load_time text;
