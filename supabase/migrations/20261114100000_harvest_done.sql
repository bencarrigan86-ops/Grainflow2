-- Whether harvest of a paddock is finished.
--
-- The harvest report compares what has been carted off a paddock with what it is expected to give. A paddock
-- that finished under its estimate would otherwise show tonnes still to come for ever; ticking it finished says
-- there is nothing more. Not an agronomy figure, so it is on fields itself, readable by anyone who can see the
-- paddock.
--
-- Optional: nothing is stored until it is set. Idempotent.

alter table fields
  add column if not exists harvest_done boolean;
