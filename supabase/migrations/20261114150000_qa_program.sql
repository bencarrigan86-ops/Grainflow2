-- The quality assurance program (and its accreditation number) named on a vendor declaration, kept with the
-- business details so it is typed once. Optional: a farm that has never filled them in has neither.
alter table farms
  add column if not exists qa_program text,
  add column if not exists qa_number text;
