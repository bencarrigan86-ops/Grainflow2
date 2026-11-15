-- Barley retention: the percentage of a sample kept above the 2.5 mm screen, on a load and on a silo
-- (optional; stored only when a retention figure is recorded). Safe to run more than once.
alter table movements
  add column if not exists retention_pct numeric(6,2);
alter table storages
  add column if not exists retention_pct numeric(6,2);
