-- Paste ALL of this into the Supabase SQL editor and press Run. Safe to run more than once.

-- What a season's opening stock was worth when the last season closed.
--
-- Carryover grain was already counted as income in the season that grew it, at
-- that season's mark-to-market price. Opening this season with the same tonnes
-- and no value would count it twice. This value is taken off this season's
-- total, so only what has changed since the close shows up here.
--
-- A dollar figure for the whole opening stock of the commodity (not $/t), because
-- it is the closing figure from last season, carried across as it stood.
--
-- Optional: nothing is stored unless it is entered. Idempotent.
alter table commodities
  add column if not exists opening_stock_value numeric(14,2);
