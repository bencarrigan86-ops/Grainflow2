-- A load can carry deductions for faults the contract does not price: [{ "reason": "Screenings 6% vs contract 5%", "perTon": 10 }].
-- Safe to run more than once.
alter table movements add column if not exists deductions jsonb;

notify pgrst, 'reload schema';
