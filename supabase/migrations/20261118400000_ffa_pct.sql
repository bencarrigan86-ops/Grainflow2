-- Canola free fatty acid (FFA): the FFA % of a load or a silo, beside the oil %.
-- Optional: stored only once an FFA figure has been recorded, so a farm without the column can still save loads.
alter table movements
  add column if not exists ffa_pct numeric(6,2);
alter table storages
  add column if not exists ffa_pct numeric(6,2);

notify pgrst, 'reload schema';
