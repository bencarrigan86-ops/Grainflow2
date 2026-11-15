-- Whether Aircair's own form is offered on a spray request (optional; stored only once it has been switched on).
-- Safe to run more than once.
alter table farms
  add column if not exists show_aircair boolean;
