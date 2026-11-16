-- Build 317: a storage can be given a volume in cubic metres. The most it holds is that volume times the test weight of what is in
-- it (the commodity's, or the one set on the storage), worked out in the app. Blank means the tonnes typed on it are used, as before.
alter table storages
  add column if not exists volume_m3 numeric(12,2);
alter table storages
  drop constraint if exists storages_volume_check;
alter table storages
  add constraint storages_volume_check check (volume_m3 is null or volume_m3 >= 0);

notify pgrst, 'reload schema';
