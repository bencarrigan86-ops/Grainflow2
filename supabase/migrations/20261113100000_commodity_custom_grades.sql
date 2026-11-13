-- A farm's own grades, per commodity.
--
-- The published grades for each commodity (APH1, Malt 1, SOR ...) are built into the app. A farm
-- can add grades of its own to any commodity, such as a buyer's house grade, and they appear
-- in the same dropdowns. They are kept here as a list of names:
--
--   [ "APW1 Plus", "Seed grade" ]
--
-- Optional: nothing is stored unless the farm has added one. Idempotent.

alter table commodities
  add column if not exists custom_grades jsonb;
