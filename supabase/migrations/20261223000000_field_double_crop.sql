-- A paddock grown straight after another crop in the same season (a double crop, no fallow between). The Position and Averages
-- reports show the yield of these apart from the rest. Empty means "not a double crop". Safe to run more than once. The same row
-- security as the rest of the paddock applies.

alter table fields add column if not exists double_crop boolean;

notify pgrst, 'reload schema';
