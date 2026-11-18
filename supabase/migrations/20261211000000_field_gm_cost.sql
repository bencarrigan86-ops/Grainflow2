-- A paddock's own gross margin cost ($ per hectare), used by the Gross margin report in place of the crop's cost spread over its
-- area. Empty means "use the crop's". Safe to run more than once. The same row security as the rest of the paddock applies.

alter table fields add column if not exists gm_cost_ha numeric;

notify pgrst, 'reload schema';
