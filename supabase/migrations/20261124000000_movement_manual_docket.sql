-- Our own manual (paper) docket number on a load, typed on the ticket.
-- Optional; stored only once one has been entered. Safe to run more than once.
alter table movements
  add column if not exists manual_docket_no text;

notify pgrst, 'reload schema';
