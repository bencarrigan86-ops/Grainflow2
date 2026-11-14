-- Hectares still to harvest on a part-harvested paddock.
--
-- A paddock can have tickets for most of its crop and still have some area to cut. Giving the hectares left lets
-- the harvest report count those hectares at the paddock's estimated yield, on top of the tonnes already in, rather
-- than working from the estimate for the whole paddock.
--
-- Optional: nothing is stored until it is set. Idempotent.

alter table fields
  add column if not exists harvest_ha_left numeric;
