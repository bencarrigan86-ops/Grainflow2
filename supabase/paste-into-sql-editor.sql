-- Paste ALL of this into the Supabase SQL editor and press Run. Safe to run more than once.

-- Running samples of a silo by tonnes from the bottom (optional; stored only when described)
alter table storages
  add column if not exists grade_bands jsonb;
