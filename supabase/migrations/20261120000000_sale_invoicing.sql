-- Who invoices on a contract: 'seller' (the farm invoices the buyer) or 'rcti' (the buyer issues a recipient created tax invoice).
-- Optional; stored only once it has been set. Safe to run more than once.
alter table sales
  add column if not exists invoicing text;

notify pgrst, 'reload schema';
