-- Build 320: the yield expected from the hectares still to harvest on a part-harvested paddock, when it differs from the paddock's own
-- yield estimate. Blank means the paddock's estimate. Optional and idempotent.

alter table fields
  add column if not exists harvest_left_yield numeric;

notify pgrst, 'reload schema';
