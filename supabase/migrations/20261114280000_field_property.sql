-- Which farm (property) a paddock belongs to, so the farm map can label each farm and show or hide them.
-- Plain text, filled in from the shapefile's farm name or typed on the paddock. Optional.
alter table fields
  add column if not exists property text;
