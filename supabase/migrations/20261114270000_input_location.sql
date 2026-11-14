-- Where an input is kept: the name of the silo, shed or other storage it was put into or taken from.
-- A name rather than a link, so the stock stays in the same place when a new season gives every storage a new id.
-- Optional: an entry with no place recorded is simply stock with no location.
alter table input_stock
  add column if not exists location text;
