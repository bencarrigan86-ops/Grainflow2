// Run with:
//   node tests/eofy.test.mjs
//
// The end of year snapshot: the grain position as at one day, what is sold and not delivered, what is delivered and not
// invoiced, and the file it is kept in.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eofySnapshot, eofyPdf, financialYearEnd } from '../docs/js/eofy.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures += 1; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const latin1 = (bytes) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

console.log('=== the financial year end ===');

check('it is the latest 30 June on or before the day', () => {
  assert.equal(financialYearEnd('2026-11-14'), '2026-06-30');
  assert.equal(financialYearEnd('2026-06-30'), '2026-06-30');
  assert.equal(financialYearEnd('2026-06-29'), '2025-06-30');
  assert.equal(financialYearEnd('2027-01-02'), '2026-06-30');
});

console.log('\n=== the snapshot ===');

const COMMODITIES = [
  { id: 'w', name: 'Wheat', mtmPrice: 300 },
  { id: 'b', name: 'Barley', mtmPrice: 250 },
];
const FIELDS = [
  { id: 'f1', commodityId: 'w', areaHa: 100, yieldTHa: 5 },     // 500 t of wheat
  { id: 'f2', commodityId: 'b', areaHa: 40, yieldTHa: 4 },      // 160 t of barley, none sold
];
const sale = (id, tons, price, extra = {}) => ({ id, commodityId: 'w', buyer: id, tons, price, date: '2026-03-01', ...extra });
const SALES = [
  sale('a', 200, 400),                                   // 100 t delivered, 50 of it invoiced
  sale('b', 100, 500),                                   // all delivered, none invoiced
  sale('late', 50, 900, { date: '2026-09-01' }),         // made after the day: left out
];
const load = (id, saleId, tons, date) => ({ id, date, froms: [], tos: [{ type: 'sale', id: saleId, tons }] });
const MOVES = [
  load('m1', 'a', 50, '2026-05-01'), load('m2', 'a', 50, '2026-06-10'),
  load('m3', 'b', 100, '2026-06-20'),
  load('m4', 'a', 25, '2026-08-01'),                     // after the day: not delivered yet on it
];
const INVOICES = [
  { id: 'i1', saleId: 'a', invoiceNo: 1, status: 'paid', paidDate: '2026-07-15', issueDate: '2026-05-05', dueDate: '2026-06-05', totalPayable: 22000, lines: [{ movementId: 'm1' }] },
  { id: 'i2', saleId: 'a', invoiceNo: 2, status: 'outstanding', issueDate: '2026-08-05', dueDate: '2026-09-05', totalPayable: 1000, lines: [{ movementId: 'm2' }] },   // issued after the day
];
const snap = eofySnapshot({ asAt: '2026-06-30', commodities: COMMODITIES, fields: FIELDS, sales: SALES, movements: MOVES, invoices: INVOICES });

check('the position counts only contracts made by the day, and values what is unsold at the average sold price', () => {
  const w = snap.position.rows.find((r) => r.commodity.id === 'w');
  assert.equal(w.productionTons, 500);
  assert.equal(w.soldTons, 300, 'the contract made in September is left out');
  assert.equal(w.soldValue, 200 * 400 + 100 * 500);
  assert.equal(w.avgSoldPrice, 433.33);
  assert.equal(w.unsoldTons, 200);
  assert.equal(w.priceBasis, 'average');
  assert.equal(w.unsoldValue, Math.round(200 * (130000 / 300) * 100) / 100);
});
check('a commodity with nothing sold is valued at its mark-to-market price, and says so', () => {
  const b = snap.position.rows.find((r) => r.commodity.id === 'b');
  assert.equal(b.unsoldTons, 160);
  assert.equal(b.priceBasis, 'mtm');
  assert.equal(b.unsoldPrice, 250);
  assert.equal(b.unsoldValue, 40000);
});
check('the position totals add up', () => {
  const p = snap.position;
  assert.equal(p.soldTons, 300);
  assert.equal(p.unsoldTons, 360);
  assert.equal(p.soldValue, 130000);
  assert.equal(p.total, Math.round((p.soldValue + p.unsoldValue) * 100) / 100);
});
check('sold, not delivered is what is left on each contract at its price, by the day', () => {
  assert.equal(snap.notDelivered.rows.length, 1, 'b is delivered in full, the September contract is not yet made');
  const a = snap.notDelivered.rows[0];
  assert.equal(a.sale.id, 'a');
  assert.equal(a.tons, 100, 'the load in August had not gone on the day');
  assert.equal(a.value, 100 * 400);
  assert.equal(snap.notDelivered.tons, 100);
  assert.equal(snap.notDelivered.value, 40000);
});
check('delivered, not invoiced leaves out loads on an invoice issued by the day, and counts one issued after it', () => {
  const rows = snap.notInvoiced.rows;
  assert.deepEqual(rows.map((r) => r.sale.id).sort(), ['a', 'b']);
  assert.equal(rows.find((r) => r.sale.id === 'a').tons, 50, 'm2 went on an invoice dated after the day');
  assert.equal(rows.find((r) => r.sale.id === 'b').tons, 100);
  assert.equal(snap.notInvoiced.tons, 150);
  assert.equal(snap.notInvoiced.value, 50 * 400 + 100 * 500);
});
check('an invoice paid after the day was still owed on it', () => {
  assert.equal(snap.unpaid.count, 1);
  assert.equal(snap.unpaid.total, 22000);
});
check('a day with nothing in it gives empty lists, not an error', () => {
  const empty = eofySnapshot({ asAt: '2026-06-30' });
  assert.deepEqual(empty.position.rows, []);
  assert.equal(empty.notDelivered.rows.length, 0);
  assert.equal(empty.notInvoiced.value, 0);
  assert.equal(empty.unpaid.total, 0);
});
check('a contract delivered within its tolerance is not owed', () => {
  const full = eofySnapshot({ asAt: '2026-06-30', commodities: COMMODITIES, fields: FIELDS, sales: [sale('z', 100, 400)], movements: [load('x', 'z', 98, '2026-05-01')], invoices: [] });
  assert.equal(full.notDelivered.rows.length, 0);
});

console.log('\n=== the file ===');

check('the PDF names the day and each part, and the people and figures on it', () => {
  const s = latin1(eofyPdf(snap, { businessName: 'Carrigan Ag Pty Ltd', commodities: COMMODITIES }));
  assert.ok(s.startsWith('%PDF-1.4'));
  for (const t of ['End of year snapshot', 'As at 30-06-2026', 'Carrigan Ag Pty Ltd', 'Grain position', 'Sold, not yet delivered', 'Delivered, not yet invoiced', 'Invoiced, not yet paid',
    'Wheat', 'Barley', '$130,000', 'MTM']) {
    assert.ok(s.includes(t), 'missing: ' + t);
  }
});
check('an empty snapshot still makes a file', () => {
  const s = latin1(eofyPdf(eofySnapshot({ asAt: '2026-06-30' })));
  assert.ok(s.includes('None'));
});

console.log('\n=== wired in ===');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
check('Position opens it, and the sheet downloads the file', () => {
  assert.ok(read('docs/js/views/position.js').includes('openEofySheet'));
  const v = read('docs/js/views/eofy.js');
  for (const t of ['eofy-date', 'eofyPdf', 'financialYearEnd', 'downloadFile']) assert.ok(v.includes(t), t);
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
