-- Widen two storage constraints to match the vocabulary the app actually uses.
--
-- Both of these were my error, not bad data. When the schema was written I
-- guessed at the values instead of reading them out of views/storage.js:
--
--   fill_state   schema said  peak, level
--                app writes   peak, flat, decline
--
--   kind         schema said  silo, bunker
--                app writes   silo, bunker, tally
--
-- 'level' has never existed anywhere in the app. 'flat' and 'decline' are the
-- two surfaces a silo actually presents — filled to a cone, struck level, or
-- drawn down into a funnel — and the volume maths in calc.js treats them as
-- three different shapes, so this is not cosmetic. 'tally' is a count-based
-- store (cotton round and lint bales) that the ginning flow in movements.js
-- depends on; without it, creating one is rejected at the database.
--
-- Fourteen of Ben's 2025 silos are 'decline'. No row anywhere is 'level', so
-- dropping it strands nothing.

alter table storages drop constraint if exists storages_fill_state_check;
alter table storages add  constraint storages_fill_state_check
  check (fill_state in ('peak','flat','decline'));

alter table storages drop constraint if exists storages_kind_check;
alter table storages add  constraint storages_kind_check
  check (kind in ('silo','bunker','tally'));

-- Anything already written under the old constraint is 'peak' (the default) or
-- 'silo'/'bunker', all of which remain legal. Nothing to backfill.
