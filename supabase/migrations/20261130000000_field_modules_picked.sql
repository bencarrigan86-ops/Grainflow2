-- Cotton modules picked on a paddock: how many, their estimated weight, the turnout and the bales that gives.
-- Safe to run more than once.
alter table fields add column if not exists modules_picked jsonb;

notify pgrst, 'reload schema';
