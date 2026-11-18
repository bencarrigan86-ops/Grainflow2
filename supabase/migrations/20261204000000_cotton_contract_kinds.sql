-- Cotton contracts with the gin: gin for seed, and ginning only. A lint sale and a seed sale outright need nothing new.
alter table sales add column if not exists cotton_kind text;
alter table sales add column if not exists cotton_terms jsonb;
