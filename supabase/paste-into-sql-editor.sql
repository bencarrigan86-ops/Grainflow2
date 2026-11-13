-- Paste ALL of this into the Supabase SQL editor and press Run. Safe to run more than once.

-- A farm's own grades for each commodity (optional; stored only when some have been added)
alter table commodities
  add column if not exists custom_grades jsonb;

-- The grades a contract lists, each with a $/t premium or discount (optional; stored only when grades are listed)
alter table sale_terms
  add column if not exists grade_options jsonb;
