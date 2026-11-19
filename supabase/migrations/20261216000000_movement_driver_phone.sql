-- The driver's phone number on a load ticket, typed on the load (the truck's rego, the driver and the transport company are already there).
-- Optional: empty means not said. Safe to run more than once. The same row security as the rest of the load applies.

alter table movements add column if not exists driver_phone text;

notify pgrst, 'reload schema';
