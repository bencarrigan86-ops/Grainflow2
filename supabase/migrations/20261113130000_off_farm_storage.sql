-- Grain held off the farm by a third party, such as GrainCorp, and a receiving site's own ticket number.
--
-- A location is an ordinary storage row carrying this extra part:
--
--   { "operator": "GrainCorp",
--     "opening": [ { "commodityId": "...", "grade": "APH1", "tons": 450 }, ... ] }
--
-- the opening holdings by commodity and grade at the start of the season. Loads into and out of the
-- location are ordinary movements; what it holds now is the opening plus what has gone in, less what
-- has come out, for each commodity and grade.
--
-- external_ticket_no is the number on the receiving site's ticket, for a load that goes to another site.
--
-- Optional: nothing is stored unless a location is off-farm or a ticket number is recorded. Idempotent.

alter table storages
  add column if not exists off_farm jsonb;
alter table movements
  add column if not exists external_ticket_no text;
