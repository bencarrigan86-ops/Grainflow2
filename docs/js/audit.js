// Audit history: the words for it.
//
// The log itself is written by the database (supabase/migrations/20261207000000_audit_log.sql) each time a contract, load, invoice,
// bill and the like is added, changed, deleted or restored. This is only what the screen says about a row of it.

/** The filter chips, and the tables each one covers. */
export const AUDIT_KINDS = [
  { id: 'sales', label: 'Sales', tables: ['sales', 'sale_terms', 'orders', 'freight_orders'] },
  { id: 'loads', label: 'Loads', tables: ['movements'] },
  { id: 'money', label: 'Money', tables: ['invoices', 'payables'] },
  { id: 'setup', label: 'Setup', tables: ['commodities', 'fields', 'storages', 'overheads', 'input_stock', 'spray_jobs', 'record_documents'] },
];

/** The word that goes before the record's name when the name alone would not say what it is. */
const PREFIX = {
  sales: 'Contract', payables: 'Bill', commodities: 'Commodity', fields: 'Field', storages: 'Storage',
  input_stock: 'Stock', record_documents: 'Document',
};

const VERB = { added: 'added', changed: 'changed', deleted: 'deleted', restored: 'restored' };

/** "Contract Riverina Grain #RGT-4471 changed". */
export function auditTitle(row) {
  const label = String(row?.label || '').trim();
  const prefix = PREFIX[row?.table_name] || '';
  const name = label || (prefix ? '' : 'Record');
  return [prefix, name, VERB[row?.action] || 'changed'].filter(Boolean).join(' ');
}

const LABEL = {
  price: 'Price', mtm_price: 'MTM price', tonnes: 'Tonnes', tons: 'Tonnes', buyer: 'Buyer', contract_no: 'Contract no.', grade: 'Grade',
  status: 'Status', amount: 'Amount', gst: 'GST', due_date: 'Due date', paid_date: 'Paid date', move_date: 'Date', sale_date: 'Sale date',
  invoice_date: 'Invoice date', truck_rego: 'Truck', truck_company: 'Carrier', driver_signature: 'Driver signature', driver_name: 'Driver', driver_phone: 'Driver phone', name: 'Name', notes: 'Notes', supplier: 'Supplier',
  payment_terms_days: 'Payment terms (days)', contract_value: 'Contract value', delivery_period: 'Delivery period', kind: 'Type',
  weight_status: 'Weight', gross_weight: 'Gross weight', tare_weight: 'Tare weight', area_ha: 'Hectares', opening_stock: 'Opening stock',
  invoice_no: 'Invoice no.', ticket_no: 'Ticket no.', order_no: 'Order no.', freight_no: 'Freight no.', reference: 'Reference',
  carrier: 'Carrier', rate: 'Rate', capacity: 'Capacity', product: 'Product', quantity: 'Quantity', unit: 'Unit',
};

const MONEY = new Set(['price', 'mtm_price', 'amount', 'gst', 'contract_value']);

/** A column name in words: "payment_terms_days" is "Payment terms (days)"; one we have no word for is spaced out. */
export function columnLabel(col) {
  if (LABEL[col]) return LABEL[col];
  const s = String(col || '').replace(/_/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

/** A before or after value as a person would write it. */
export function valueText(col, v) {
  if (v === null || v === undefined || v === '') return 'blank';
  if (v === '...') return 'edited';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') {
    const s = Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
    return MONEY.has(col) ? `$${s}` : s;
  }
  if (typeof v === 'object') return 'edited';
  return String(v);
}

/** The changes of an entry, a line each: [{ label, from, to }]. Added and deleted entries have none. */
export function changeLines(row) {
  const ch = row?.changes;
  if (!ch || typeof ch !== 'object') return [];
  return Object.entries(ch)
    .filter(([, pair]) => Array.isArray(pair))
    .map(([col, [from, to]]) => ({ label: columnLabel(col), from: valueText(col, from), to: valueText(col, to) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** "Price $320 to $335" and "and 2 more", for the list; '' when there is nothing to say. */
export function changeSummary(row, max = 2) {
  const lines = changeLines(row);
  if (lines.length === 0) return '';
  const shown = lines.slice(0, max).map((l) => (l.from === 'edited' && l.to === 'edited' ? `${l.label} edited` : `${l.label} ${l.from} → ${l.to}`));
  return lines.length > max ? `${shown.join(', ')} and ${lines.length - max} more` : shown.join(', ');
}

/** Who made the change: "ben (manager)"; the server itself when nobody was signed in. */
export function whoText(row) {
  const email = String(row?.user_email || '');
  const name = email.includes('@') ? email.split('@')[0] : email;
  const role = String(row?.user_role || '').replace('farm_worker', 'worker');
  if (!name) return 'The server';
  return role ? `${name} (${role})` : name;
}

const p2 = (n) => String(n).padStart(2, '0');
const dmy = (d) => `${p2(d.getDate())}-${p2(d.getMonth() + 1)}-${d.getFullYear()}`;

/** "2:14 pm". */
export function timeText(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).replace(/ /g, ' ');
}

/** "Today", "Yesterday" or "Mon 16-11-2026". */
export function dayHeading(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return `${d.toLocaleDateString('en-AU', { weekday: 'short' })} ${dmy(d)}`;
}

/**
 * What is typed in the search box, made safe to put in the server's filter: the characters that mean something in it (commas,
 * brackets, wildcards, backslashes) become spaces. '' when there is nothing to look for.
 */
export function auditSearchTerm(text) {
  return String(text ?? '').replace(/[%*_,()\\"']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** The entries of one kind (or all), newest first. */
export function filterAudit(rows, kind = '') {
  const tables = AUDIT_KINDS.find((k) => k.id === kind)?.tables;
  return (rows || [])
    .filter((r) => !tables || tables.includes(r.table_name))
    .slice()
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** Entries under a heading for each day: [{ heading, rows }], in the order given. */
export function groupByDay(rows, now = new Date()) {
  const out = [];
  for (const r of rows || []) {
    const heading = dayHeading(r.at, now);
    const last = out[out.length - 1];
    if (last && last.heading === heading) last.rows.push(r);
    else out.push({ heading, rows: [r] });
  }
  return out;
}

/** Who may read the audit history. */
export const canSeeAudit = (role) => ['owner', 'manager', 'bookkeeper'].includes(role);

/** "16-11-2026, 2:14 pm". */
export function whenFull(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${dmy(d)}, ${timeText(iso)}`;
}
