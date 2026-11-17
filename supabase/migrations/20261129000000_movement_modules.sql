-- Cotton modules carted from a paddock to the gin yard: how many, their weight, the turnout and the bales that gives.
-- Safe to run more than once.
alter table movements add column if not exists modules jsonb;

notify pgrst, 'reload schema';
