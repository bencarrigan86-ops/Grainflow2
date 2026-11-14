// Run with:
//   node tests/xero.test.mjs
//
// The Xero export: sales invoices and bills as rows in Xero's import layout.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { xeroInvoices, xeroBills, xeroCsv, xeroDate, financialYearStart, XERO_COLUMNS, DEFAULT_CODES } from '../docs/js/xero.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures += 1; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

const COMMODITIES = [{ id: 'w', name: 'Wheat' }];
const SALES = [{ id: 's1', commodityId: 'w', buyer: 'Riverina Grain Traders', buyerContact: 'Jo 0400 000 000 jo@x.com.au', contractNo: 'RGT-4471', price: 400 }];
const INV = {
  id: 'i1', saleId: 's1', invoiceNo: 12, issueDate: '2026-11-05', dueDate: '2026-12-05', status: 'outstanding',
  lines: [
    { date: '2026-11-01', rego: 'ABC123', tons: 30, ticketNo: '501', grade: 'APW1', rate: 410, subtotal: 12300 },
    { date: '2026-11-02', rego: 'XYZ9', tons: 20, rate: 400, subtotal: 8000 },
    { date: '2026-11-05', rego: 'Adjustment', tons: null, rate: null, subtotal: -100, description: 'Quality discount' },
  ],
  subtotalExGST: 20200, levies: 101, freightTotal: 500, gst: 2020, totalPayable: 21619,
};

console.log('=== dates and the year ===');
check('Xero reads DD/MM/YYYY; the financial year starts on 1 July', () => {
  assert.equal(xeroDate('2026-11-05'), '05/11/2026');
  assert.equal(xeroDate(''), '');
  assert.equal(financialYearStart('2026-11-14'), '2026-07-01');
  assert.equal(financialYearStart('2027-03-01'), '2026-07-01');
  assert.equal(financialYearStart('2026-06-30'), '2025-07-01');
});

console.log('\n=== sales invoices ===');
const out = xeroInvoices({ invoices: [INV], sales: SALES, commodities: COMMODITIES, from: '2026-07-01', to: '2027-06-30' });
check('an invoice is a line per load and adjustment, repeating the invoice details', () => {
  assert.equal(out.count, 1);
  const grain = out.rows.filter((r) => r['*TaxType'] === 'GST on Income');
  assert.equal(grain.length, 3);
  assert.equal(grain[0]['*ContactName'], 'Riverina Grain Traders');
  assert.equal(grain[0]['*InvoiceNumber'], 12);
  assert.equal(grain[0].Reference, 'RGT-4471');
  assert.equal(grain[0]['*InvoiceDate'], '05/11/2026');
  assert.equal(grain[0]['*DueDate'], '05/12/2026');
  assert.equal(grain[0].EmailAddress, 'jo@x.com.au');
  assert.equal(grain[0]['*Description'], 'Wheat ticket 501 01/11/2026 APW1');
  assert.equal(grain[0]['*Quantity'], 30);
  assert.equal(grain[0]['*UnitAmount'], 410);
  assert.equal(grain[0]['*AccountCode'], DEFAULT_CODES.sales);
  assert.equal(grain[1]['*Description'], 'Wheat XYZ9 02/11/2026');
  assert.equal(grain[2]['*Description'], 'Quality discount');
  assert.equal(grain[2]['*Quantity'], 1);
  assert.equal(grain[2]['*UnitAmount'], -100);
});
check('levies and freight the buyer takes off are lines without GST', () => {
  const free = out.rows.filter((r) => r['*TaxType'] === 'BAS Excluded');
  assert.deepEqual(free.map((r) => [r['*Description'], r['*UnitAmount']]), [['Grain levies deducted', -101], ['Freight deducted by buyer', -500]]);
});
check('what Xero would add up to is what the app says is payable', () => {
  const lines = out.rows.map((r) => ({ amount: r['*Quantity'] * r['*UnitAmount'], gst: r['*TaxType'] === 'GST on Income' }));
  const ex = lines.reduce((s, l) => s + l.amount, 0);
  const gst = lines.filter((l) => l.gst).reduce((s, l) => s + l.amount, 0) * 0.1;
  assert.equal(Math.round((ex + gst) * 100) / 100, INV.totalPayable);
});
check('only invoices in the date range, oldest first; account codes can be changed', () => {
  const later = { ...INV, id: 'i2', invoiceNo: 13, issueDate: '2027-08-01' };
  const earlier = { ...INV, id: 'i0', invoiceNo: 11, issueDate: '2026-10-01' };
  const r = xeroInvoices({ invoices: [INV, later, earlier], sales: SALES, commodities: COMMODITIES, from: '2026-07-01', to: '2027-06-30', codes: { ...DEFAULT_CODES, sales: '260' } });
  assert.equal(r.count, 2);
  assert.deepEqual([...new Set(r.rows.map((x) => x['*InvoiceNumber']))], [11, 12]);
  assert.equal(r.rows[0]['*AccountCode'], '260');
});
check('an invoice missing its buyer or date is exported and warned about', () => {
  const r = xeroInvoices({ invoices: [{ ...INV, issueDate: '', saleId: 'gone' }], sales: SALES, commodities: COMMODITIES, from: '2026-07-01', to: '2027-06-30' });
  assert.equal(r.count, 1);
  assert.equal(r.rows[0]['*ContactName'], 'Unknown buyer');
  assert.equal(r.warnings.length, 2);
});

console.log('\n=== bills ===');
const BILLS = [
  { id: 'b1', kind: 'freight', supplier: 'Ace Haulage', reference: 'AH-77', invoiceDate: '2026-11-10', dueDate: '2026-12-10', amount: 1000, gst: 100, notes: 'Contract RGT-4471' },
  { id: 'b2', kind: 'storage', supplier: 'Silo Co', reference: '', invoiceDate: '2026-11-12', amount: 300, gst: 0 },
  { id: 'b3', kind: 'other', supplier: 'Vet', invoiceDate: '2025-01-01', amount: 50, gst: 5 },
];
const bills = xeroBills({ payables: BILLS, from: '2026-07-01', to: '2027-06-30' });
check('a bill is one line at its amount before GST, coded by what it is', () => {
  assert.equal(bills.count, 2, 'the bill from 2025 is outside the range');
  const f = bills.rows[0];
  assert.equal(f['*ContactName'], 'Ace Haulage');
  assert.equal(f['*InvoiceNumber'], 'AH-77');
  assert.equal(f['*Description'], 'Freight - Contract RGT-4471');
  assert.equal(f['*UnitAmount'], 1000);
  assert.equal(f['*AccountCode'], DEFAULT_CODES.freight);
  assert.equal(f['*TaxType'], 'GST on Expenses');
  assert.equal(f['*DueDate'], '10/12/2026');
});
check('a bill with no GST is GST free, and one with no reference still gets a number', () => {
  const s = bills.rows[1];
  assert.equal(s['*TaxType'], 'GST Free Expenses');
  assert.equal(s['*DueDate'], '12/11/2026');
  assert.equal(s['*InvoiceNumber'], 'Storage 12/11/2026');
  assert.equal(s['*AccountCode'], DEFAULT_CODES.storage);
});
check('GST that is not a tenth of the amount is warned about', () => {
  const w = xeroBills({ payables: [{ ...BILLS[0], gst: 50 }], from: '', to: '' });
  assert.ok(w.warnings.some((x) => /GST/.test(x)));
  assert.equal(bills.warnings.length, 0);
});

console.log('\n=== the file ===');
check('the CSV starts with the Xero column names and quotes what needs it', () => {
  const csv = xeroCsv(out.rows);
  const [head, first] = csv.split('\r\n');
  assert.equal(head, XERO_COLUMNS.join(','));
  assert.ok(first.startsWith('Riverina Grain Traders,jo@x.com.au,'));
  assert.equal(first.split(',').length, XERO_COLUMNS.length);
  const q = xeroCsv(xeroBills({ payables: [{ ...BILLS[0], supplier: 'Ace, Haulage "Pty"' }], from: '', to: '' }).rows);
  assert.ok(q.includes('"Ace, Haulage ""Pty"""'));
});

console.log('\n=== wired in ===');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
check('the money sheet opens it, for the roles that see invoices and bills', () => {
  const o = read('docs/js/views/outstanding.js');
  assert.ok(o.includes('openXeroSheet') && o.includes('id="open-xero"'));
  assert.ok(o.includes("['owner', 'manager', 'bookkeeper'].includes(db.getRole()) ? '<button type=\"button\" class=\"btn secondary\" id=\"open-xero\""));
  const v = read('docs/js/views/xero.js');
  for (const t of ['xr-from', 'xr-to', 'downloadCSV', 'xeroInvoices', 'xeroBills']) assert.ok(v.includes(t), t);
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
