-- Where a load is going, typed on the load (optional; stored only when something is typed). It is shown on the load
-- report and the load ticket, in place of the contract's own delivery site. Safe to run more than once.
alter table movements
  add column if not exists load_destination text;
