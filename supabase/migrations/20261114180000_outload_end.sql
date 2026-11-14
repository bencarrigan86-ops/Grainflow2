-- Which end of a bunker is emptied first (see paste-into-sql-editor.sql).
-- Which end of a bunker is emptied first: 'last' (last in, first out; the default) or 'first' (first in, first out,
-- from the back, for a bunker that can be opened at both ends). Optional: stored only once it has been set.
alter table storages
  add column if not exists outload_end text;
alter table storages
  drop constraint if exists storages_outload_end_check;
alter table storages
  add constraint storages_outload_end_check check (outload_end is null or outload_end in ('last', 'first'));
