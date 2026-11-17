-- The farm's logo: a small JPEG kept as text (a data address), printed in the header of the PDFs.
-- Optional; stored only once a logo has been added. Safe to run more than once.
alter table farms
  add column if not exists logo text;

-- The people who sign for the business: their names, one to a line, offered as the printed name on documents.
alter table farms
  add column if not exists signers text;

-- Whether the logo is switched off (it is printed whenever there is one, unless this is true).
alter table farms
  add column if not exists logo_off boolean;
