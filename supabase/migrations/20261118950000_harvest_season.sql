-- Build 318: which part of the year a commodity is harvested in (winter or summer), so harvest progress can be read for each. Blank means
-- automatic: the app goes by the commodity's name.
alter table commodities
  add column if not exists harvest_season text;
alter table commodities
  drop constraint if exists commodities_harvest_season_check;
alter table commodities
  add constraint commodities_harvest_season_check check (harvest_season is null or harvest_season in ('winter', 'summer'));

notify pgrst, 'reload schema';
