// Telling "the server refused this account the table" from "the read failed".
//
// A restricted table (a driver cannot read sale_terms) answers with a permission error or with nothing; a table the project
// does not have yet answers that it does not exist. Those are expected, and the app runs without the table. Anything else (no
// signal, a timeout, a server error, an expired login) says nothing about what the table holds, and must never be taken for an
// empty table: a farm built from it would show every contract at $0 and send that back on the next save.

export function isDenial(error) {
  if (!error) return false;
  if (['42501', '42P01', 'PGRST205', 'PGRST202'].includes(error.code)) return true;
  return /permission denied|row-level security|does not exist|could not find the table/i.test(error.message || '');
}
