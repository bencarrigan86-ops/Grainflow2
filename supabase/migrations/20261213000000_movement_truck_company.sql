-- The trucking company that carted a load, typed on the load ticket (the truck's rego and the driver are already there). Optional: empty
-- means not said. Safe to run more than once. The same row security as the rest of the load applies.

alter table movements add column if not exists truck_company text;

notify pgrst, 'reload schema';
