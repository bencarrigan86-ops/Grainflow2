// Recently deleted: the words for it.
//
// The list itself comes from the server (list_deleted, see supabase/migrations/20261114130000_recently_deleted.sql),
// because deleted rows are hidden from the app's ordinary reads. This is only what the screen says about them.

const TYPE = {
  commodities: 'Commodity',
  fields: 'Paddock',
  storages: 'Silo or bunker',
  movements: 'Movement',
  orders: 'Order',
  sales: 'Contract',
  invoices: 'Invoice',
  payables: 'Bill',
};

/** What to call a kind of record. */
export const typeLabel = (tbl) => TYPE[tbl] || 'Record';

/** The kinds that can be brought back, in the order the filter shows them. */
export const TYPES = Object.keys(TYPE);

/** "12 Nov, 3:40 pm" for a timestamp from the server; '' if it is not one. */
export function whenText(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}, ${d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`;
}

/**
 * What to say when bringing a record back failed. The server's own sentences for the rules it applies
 * ("Restore its contract first") are fine to show as they are; anything else gets a plain line.
 */
export function restoreMessage(message) {
  const m = String(message || '');
  if (/contract first|season that was deleted/i.test(m)) return m;
  if (/not allowed|not authenticated/i.test(m)) return 'Your sign-in is not allowed to restore that.';
  if (/not found/i.test(m)) return 'That record is no longer there to restore.';
  return 'Could not restore it. Check your signal and try again.';
}

/** Rows from the server, newest deleted first, optionally only one kind. */
export function visibleDeleted(rows, kind = '') {
  return (rows || [])
    .filter((r) => !kind || r.tbl === kind)
    .slice()
    .sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at)));
}
