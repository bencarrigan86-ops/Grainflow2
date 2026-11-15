-- How a contract is delivered: 'call' (the buyer orders it) or 'even' (spread evenly over the window).
-- Optional; stored only once it has been set. Safe to run more than once.
alter table sales
  add column if not exists delivery_pattern text;
