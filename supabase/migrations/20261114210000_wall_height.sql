-- Bunkers and sheds can have walls. The wall height (metres) goes into the capacity and tarp calculations: the grain is
-- held straight up to the top of the walls, with the peaked pile on top. Blank means no walls.
alter table storages
  add column if not exists wall_height_m numeric(6,2);
alter table storages
  drop constraint if exists storages_wall_height_check;
alter table storages
  add constraint storages_wall_height_check check (wall_height_m is null or wall_height_m >= 0);
