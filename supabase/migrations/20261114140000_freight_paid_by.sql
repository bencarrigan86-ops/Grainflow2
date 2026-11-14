-- Who pays the freight on a contract: 'we' (the farm pays the carrier, a bill in Payables, nothing on the grain
-- invoice) or 'buyer' (the buyer deducts it from the invoice). Optional: a contract that has never been set is 'we'.
-- Lives in sale_terms with the other money terms, which a field device never receives.
alter table sale_terms
  add column if not exists freight_paid_by text check (freight_paid_by in ('we', 'buyer'));
