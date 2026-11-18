#!/usr/bin/env node
//
// The invoice and the adjustment note as PDF files, and the way out of the invoice screen.
//
//   node tests/invoicepdf.test.mjs
//
// The browser's print dialog is not on every phone, so the invoice screen makes a file the person can share or save.

import assert from 'node:assert';
import fs from 'node:fs';
import { invoicePdf, adjustmentPdf, bankRows } from '../docs/js/invoicepdf.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const text = (bytes) => Buffer.from(bytes).toString('latin1');
const pagesOf = (bytes) => (text(bytes).match(/\/Type\s*\/Page\b/g) || []).length;

const business = { entityName: 'Test Farming Pty Ltd', abn: '12 345 678 901', ngr: '1234567', contactName: 'Pat Farmer', bankName: 'Test Bank', accountName: 'Test Farming', bsb: '123-456', accountNumber: '11112222' };
const sale = { id: 's1', contractNo: 'C-100', buyer: 'Buyer Co', buyerAbn: '98 765 432 109', grade: 'APW1', location: 'Mill' };
const line = (n) => ({ date: '2026-12-01', ticketNo: n, rego: `TRK${n}`, grade: 'APW1', tons: 30 + n, basePrice: 400, adjust: n === 1 ? -10 : null, rate: n === 1 ? 390 : 400, subtotal: (30 + n) * 400, movementId: `m${n}`, deductions: n === 1 ? [{ reason: 'Screenings 6% vs 5%', perTon: 10 }] : [] });
const invoice = (n = 3) => ({ id: 'i1', invoiceNo: 7, issueDate: '2026-12-02', dueDate: '2027-01-02', lines: Array.from({ length: n }, (_, i) => line(i + 1)), totalTons: 100, subtotalExGST: 40000, levies: 120, freightTotal: 0, gst: 3988, totalPayable: 43868 });

check('a grain invoice is a PDF with the totals the screen has', () => {
  const b = invoicePdf({ sale, invoice: invoice(), business, commodity: { name: 'Wheat' } });
  assert.ok(text(b).startsWith('%PDF'));
  for (const w of ['TAX INVOICE', 'Invoice #7', 'Buyer Co', 'Total amount payable', 'Grain levies', 'Payment details', '11112222']) assert.ok(text(b).includes(w), `has "${w}"`);
});

check('a long invoice runs onto more pages', () => {
  assert.ok(pagesOf(invoicePdf({ sale, invoice: invoice(70), business, commodity: { name: 'Wheat' } })) > 1, 'many lines make more pages');
  assert.equal(pagesOf(invoicePdf({ sale, invoice: invoice(2), business, commodity: { name: 'Wheat' } })), 1);
});

check('no bank details, none printed (a manager does not get them)', () => {
  assert.deepEqual(bankRows({ entityName: 'X' }), []);
  const b = invoicePdf({ sale, invoice: invoice(), business: { entityName: 'X' }, commodity: { name: 'Wheat' } });
  assert.ok(!text(b).includes('Payment details'));
});

check('freight taken off shows in its own section', () => {
  const inv = invoice(2); inv.lines[0].freight = 300; inv.lines[0].freightRate = 10; inv.freightTotal = 300;
  const b = invoicePdf({ sale, invoice: inv, business, commodity: { name: 'Wheat' } });
  assert.ok(text(b).includes('Freight deducted') && text(b).includes('Total freight'));
});

check('a cotton invoice is a PDF with the bale range and the gin invoices taken off', () => {
  const lines = [
    { date: '2026-06-01', rego: '-', tons: 100, movementId: 'm1', rate: 630, subtotal: 63000, bales: 50, baleRanges: [{ from: 'BG1', to: 'BG50', bales: 50 }] },
    { date: '2026-06-02', rego: '-', description: 'Gin invoice I051', amount: -1000, gin: true, ginInvoiceId: 'g1', subtotal: -1000 },
  ];
  const b = invoicePdf({ sale: { ...sale, commodityId: 'c' }, invoice: { id: 'i2', invoiceNo: 9, issueDate: '2026-06-03', dueDate: '2026-07-03', lines, subtotalExGST: 63000, gst: 6300, levies: 0, freightTotal: 0, totalPayable: 68300 }, business, commodity: { name: 'Cotton', unit: 'bale' } });
  assert.ok(text(b).startsWith('%PDF') && text(b).includes('TAX INVOICE') && text(b).includes('Payment is calculated as follows'));
});

check('an adjustment note says what it adjusts and what is now payable', () => {
  const original = { id: 'i1', invoiceNo: 7, issueDate: '2026-12-02', totalPayable: 1000, subtotalExGST: 909.09, gst: 90.91 };
  const note = { id: 'n1', kind: 'adjustment', adjustsInvoiceId: 'i1', invoiceNo: 8, issueDate: '2026-12-10', reason: 'Weight corrected', subtotalExGST: -100, gst: -10, totalPayable: -110, status: 'outstanding' };
  const b = adjustmentPdf({ sale, note, invoices: [original, note], business });
  for (const w of ['ADJUSTMENT NOTE', 'Weight corrected', 'decreases', 'Amount now payable']) assert.ok(text(b).includes(w), `has "${w}"`);
  assert.ok(!text(b).includes('Payment details'), 'a credit does not ask for payment');
});

check('the invoice screen offers Share, Download and Print, and the print button is no longer the only way out', () => {
  const src = fs.readFileSync(new URL('../docs/js/views/invoice.js', import.meta.url), 'utf8');
  assert.ok(src.includes('id="send-invoice"') && src.includes('id="download-invoice"'));
  assert.ok(src.split('${pdfButtonsHtml()}').length === 3, 'on the invoice and on the adjustment note');
  assert.ok(src.includes('invoicePdf({ sale, invoice, business, commodity, signature: signedWith') && src.includes('adjustmentPdf({ sale, note, invoices, business })'));
});

check('on a ticket, the premium or discount has a plus/minus button because the number pad has no minus key', () => {
  const src = fs.readFileSync(new URL('../docs/js/views/movements.js', import.meta.url), 'utf8');
  assert.ok(src.includes('ded-sign') && src.includes('inputmode="decimal"'));
  assert.ok(!src.includes('class="ded-per" type="number"'), 'a number input cannot hold a lone minus');
});

console.log('');
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('ALL PASS');
