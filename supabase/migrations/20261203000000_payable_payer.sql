-- Who settles a bill: blank means the farm; 'buyer' means the buyer of the lint pays the gin and takes it off the lint payment.
-- Safe to run more than once.
alter table payables add column if not exists payer text;

notify pgrst, 'reload schema';
