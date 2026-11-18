-- What the buyer puts on a grain order: issuer, grade, destination, address, reference, booking, site rules. One column, saved as a whole.
alter table orders add column if not exists detail jsonb;
-- and what the carrier's copy of a freight order carries: carrier ABN and contact, variety, packaging, payment terms, the two sites.
alter table freight_orders add column if not exists detail jsonb;
