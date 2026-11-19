-- The driver's signature on a load, drawn on the phone: the lines it was drawn with, the name under it, when, and a short print of
-- what the load said at that moment (so a later change to the load can be flagged). Optional: empty means not signed.
-- Safe to run more than once. The same row security as the rest of the load applies.

alter table movements add column if not exists driver_signature jsonb;

notify pgrst, 'reload schema';
