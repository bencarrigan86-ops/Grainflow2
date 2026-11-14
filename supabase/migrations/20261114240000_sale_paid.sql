-- A contract that has been paid in full and is finished with: hidden from the main list and the pick lists, still kept.
-- Optional: a contract never marked has no value.
alter table sales
  add column if not exists is_paid boolean;
