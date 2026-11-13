-- Paste ALL of this into the Supabase SQL editor and press Run. Safe to run more than once.

-- A farm's own grades for each commodity (optional; stored only when some have been added)
alter table commodities
  add column if not exists custom_grades jsonb;

-- The grades a contract lists, each with a $/t premium or discount (optional; stored only when grades are listed)
alter table sale_terms
  add column if not exists grade_options jsonb;

-- Canola oil: the oil % of a load or a silo, and a contract's base oil and % of price per 1% of oil
-- (optional; stored only when oil is recorded or a contract is priced for it)
alter table movements
  add column if not exists oil_pct numeric(6,2);
alter table storages
  add column if not exists oil_pct numeric(6,2);
alter table sale_terms
  add column if not exists oil_base_pct numeric(6,2),
  add column if not exists oil_adjust_pct numeric(6,2);

-- Off-farm storage: grain held by a third party, with who runs it and what it held at the start of the
-- season by commodity and grade (optional; stored only on a location that is off-farm)
alter table storages
  add column if not exists off_farm jsonb;

-- The receiving site's own ticket number on a load (optional; stored only when one is recorded)
alter table movements
  add column if not exists external_ticket_no text;
