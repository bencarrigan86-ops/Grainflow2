-- A contract that lists several grades, each with its own premium or discount.
--
-- The contract's price is for the grade it names. This holds the others it will take, each with a
-- $/t adjustment on top of the price (negative for a discount):
--
--   [ { "grade": "APW1", "adjust": 0 }, { "grade": "H2", "adjust": 15 }, { "grade": "ASW1", "adjust": -20 } ]
--
-- Each load delivered is paid the price plus the adjustment for its own grade; a load whose grade is
-- not listed is paid the price as it stands. In sale_terms, with the other figures that move a
-- contract's value, so a field device never receives it.
--
-- Optional: nothing is stored unless a grade is listed. Idempotent.

alter table sale_terms
  add column if not exists grade_options jsonb;
