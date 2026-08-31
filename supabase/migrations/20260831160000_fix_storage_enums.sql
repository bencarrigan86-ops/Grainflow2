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
-- ORDER MATTERS HERE, and I got it wrong twice before getting it right:
--
--   attempt 1   constraint first          — failed, existing rows held 'level'
--   attempt 2   update, then constraint   — failed, the update wrote 'flat'
--                                           while the old constraint was still
--                                           in force and rejected it
--   attempt 3   drop, update, add         — this one
--
-- A check constraint polices every write, including the write that exists to
-- make the rows legal. So the old rule comes off before the data moves, and
-- the new rule goes on after.

-- ---------------------------------------------------------------------------
-- 1. Take the old rules off.
-- ---------------------------------------------------------------------------

alter table storages drop constraint if exists storages_fill_state_check;
alter table storages drop constraint if exists storages_kind_check;

-- ---------------------------------------------------------------------------
-- 2. Normalise the one value that should never have existed.
--
-- 'level' can only have come from the constraint I invented — no build of the
-- app has ever written it, and the storage editor cannot render it (it falls
-- through to 'peak' and shows the wrong volume). 'flat' is what it was
-- standing in for, so that is where it goes.
--
-- Note what is deliberately absent: a catch-all that rewrites anything
-- unexpected to the default. If some other value is in that column I want the
-- step below to fail and show me, rather than silently overwrite a row I have
-- never looked at. A migration that cannot fail is a migration that cannot
-- tell you it was wrong.
--
-- kind needs no equivalent: the rule it replaces allowed only 'silo' and
-- 'bunker', both of which stay legal, so nothing can be stranded.
-- ---------------------------------------------------------------------------

update storages set fill_state = 'flat' where fill_state = 'level';

-- ---------------------------------------------------------------------------
-- 3. Put the correct rules on.
-- ---------------------------------------------------------------------------

alter table storages add constraint storages_fill_state_check
  check (fill_state in ('peak','flat','decline'));

alter table storages add constraint storages_kind_check
  check (kind in ('silo','bunker','tally'));
