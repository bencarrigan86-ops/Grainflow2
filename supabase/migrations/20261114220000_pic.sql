-- The property identification code (PIC) named on the national vendor declaration, kept with the business details.
alter table farms
  add column if not exists pic text;
