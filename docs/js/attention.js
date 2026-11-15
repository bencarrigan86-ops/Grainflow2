// What needs looking at today: the short list at the top of Position.
//
// Nothing here is new data. It reads what the app already works out (overdue invoices and bills, contracts past their
// end, orders that missed their date, grain delivered but not invoiced, a backup that is due) and says it in a line each,
// the worst first, so the farm is not left to go and look. Pure: it touches neither storage nor the page.

import { receivables, payablesDue, deliveries, uninvoiced } from './outstanding.js?v=279';
import { backupDue, backupAgeText } from './backup.js?v=279';

const MONEY_ROLES = ['owner', 'manager', 'bookkeeper'];
const SEVERITY = { bad: 0, warn: 1, info: 2 };

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const money0 = (n) => `$${Math.round(Number(n) || 0).toLocaleString('en-AU')}`;

/**
 * @param {{role: string, today: string, invoices?: object[], sales?: object[], movements?: object[], orders?: object[],
 *          payables?: object[], lastBackup?: number|null, now?: number}} s
 * @returns {{id: string, tone: 'bad'|'warn'|'info', title: string, detail: string, action: string}[]}
 *   `action` is what tapping it opens: 'money' (Receivables & payables), 'deliveries' (Deliveries to go) or 'settings'.
 */
export function attentionItems(s) {
  const { role, today, invoices = [], sales = [], movements = [], orders = [], payables = [], lastBackup = null, now = Date.now() } = s;
  const out = [];

  if (MONEY_ROLES.includes(role)) {
    const rec = receivables(invoices, sales, today);
    if (rec.overdue.count) {
      out.push({ id: 'invoices-overdue', tone: 'bad', action: 'money',
        title: `${plural(rec.overdue.count, 'invoice')} overdue`, detail: `${money0(rec.overdue.total)} still to come in from buyers` });
    }
    const bills = payablesDue(payables, today);
    if (bills.overdue.count) {
      out.push({ id: 'bills-overdue', tone: 'bad', action: 'money',
        title: `${plural(bills.overdue.count, 'bill')} overdue`, detail: `${money0(bills.overdue.total)} you owe` });
    }

    const del = deliveries(sales, movements, orders, today);
    if (del.ended.count) {
      out.push({ id: 'contracts-ended', tone: 'bad', action: 'deliveries',
        title: `${plural(del.ended.count, 'contract')} past the end date`, detail: `${Math.round(del.ended.due)} t still owed on them` });
    }
    if (del.ordersOverdue) {
      out.push({ id: 'orders-overdue', tone: 'warn', action: 'deliveries',
        title: `${plural(del.ordersOverdue, 'grain order')} past the date`, detail: 'The buyer asked for it by a date that has gone' });
    }
    if (del.soon.count) {
      out.push({ id: 'contracts-soon', tone: 'warn', action: 'deliveries',
        title: `${plural(del.soon.count, 'contract')} ending within 30 days`, detail: `${Math.round(del.soon.due)} t still to deliver on them` });
    }

    const unb = uninvoiced(sales, movements, invoices, today);
    if (unb.total.count) {
      const waited = unb.rows.filter((r) => r.days !== null && r.days > 14);
      if (waited.length) {
        out.push({ id: 'not-invoiced', tone: 'warn', action: 'money',
          title: `${plural(waited.length, 'contract')} delivered but not invoiced for over 2 weeks`, detail: `${money0(waited.reduce((a, r) => a + r.value, 0))} at the contract price` });
      }
    }
  }

  if (role === 'owner' && backupDue({ last: lastBackup, hasRecords: sales.length + movements.length > 0, now })) {
    out.push({ id: 'backup', tone: 'info', action: 'settings',
      title: 'Back up your farm', detail: `${lastBackup ? `Your last backup on this device was ${backupAgeText(lastBackup, now)}.` : 'You have not made a backup on this device yet.'} It takes a tap in Settings.` });
  }

  return out.sort((a, b) => SEVERITY[a.tone] - SEVERITY[b.tone]);
}
