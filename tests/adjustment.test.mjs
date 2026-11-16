// Run with:
//   node tests/adjustment.test.mjs
//
// Adjustment notes: a numbered correction to an invoice already issued, made from the difference against the buyer's RCTI.
// It is a record in the invoices list, so it needs no new table; it counts in what the buyer owes, and stays out of the
// tax invoices (the Xero invoice file, the invoice run of numbers).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isAdjustment, noteLabel, invoiceLabel, refLabel, adjustmentsFor, netPayable, nextNoteNo, rctiAdjustment, buildAdjustment, applyAdjustment, withoutAdjustment } from '../docs/js/adjustment.js';
import { receivables } from '../docs/js/outstanding.js';
import { buyerStatements } from '../docs/js/statement.js';
import { xeroInvoices, xeroAdjustments, XERO_COLUMNS } from '../docs/js/xero.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const SALE = { id: 'sale-1', buyer: 'Acme Grain', contractNo: 'C-7', commodityId: 'c1' };
const INV = { id: 'inv-1', saleId: 'sale-1', invoiceNo: 12, issueDate: '2026-11-01', dueDate: '2026-11-15', status: 'outstanding', lines: [], subtotalExGST: 10000, freightTotal: 0, levies: 0, gst: 1000, totalPayable: 11000, rctiNo: 'R-55', rctiTotal: 10450 };

check('the amount to adjust is theirs less ours, so a smaller RCTI is a credit', () => {
  const a = rctiAdjustment(INV);
  assert.equal(a.amount, -550);
  assert.ok(a.reason.includes('R-55'));
  assert.equal(rctiAdjustment({ ...INV, rctiTotal: 11250 }).amount, 250, 'a larger RCTI is an extra charge');
  assert.equal(rctiAdjustment({ ...INV, rctiTotal: 11000 }), null, 'agreeing needs no note');
  assert.equal(rctiAdjustment({ ...INV, rctiTotal: null }), null);
  assert.equal(rctiAdjustment({ ...INV, rctiTotal: '' }), null);
});

check('a note splits its GST out of an amount that has it in, or carries none', () => {
  const credit = buildAdjustment({ original: INV, amount: -550, reason: 'Quality discount', issueDate: '2026-11-20', paymentTermsDays: 14 });
  assert.equal(credit.totalPayable, -550);
  assert.equal(credit.gst, -50);
  assert.equal(credit.subtotalExGST, -500);
  assert.equal(credit.kind, 'adjustment');
  assert.equal(credit.adjustsInvoiceId, 'inv-1');
  assert.equal(credit.adjustsInvoiceNo, 12);
  assert.equal(credit.dueDate, null, 'a credit has nothing to pay, so no due date to run overdue');
  const free = buildAdjustment({ original: INV, amount: -80, gstApplies: false, issueDate: '2026-11-20' });
  assert.equal(free.gst, 0);
  assert.equal(free.subtotalExGST, -80);
  const extra = buildAdjustment({ original: INV, amount: 110, issueDate: '2026-11-20', paymentTermsDays: 14 });
  assert.equal(extra.dueDate, '2026-12-04', 'money owed is due on the usual terms');
  assert.equal(extra.reason, 'Additional charge', 'a reason is filled in when none is typed');
  assert.equal(buildAdjustment({ original: INV, amount: 0, issueDate: '2026-11-20' }), null);
  assert.equal(buildAdjustment({ original: INV, amount: 'x', issueDate: '2026-11-20' }), null);
});

check('the note has a number of its own, and the invoice run of numbers is not used', () => {
  assert.equal(nextNoteNo([]), 1);
  assert.equal(nextNoteNo([INV]), 1, 'tax invoices do not count');
  const n1 = { ...buildAdjustment({ original: INV, amount: -10, issueDate: '2026-11-20' }), id: 'n1', noteNo: 1 };
  const n2 = { ...buildAdjustment({ original: INV, amount: 5, issueDate: '2026-11-21' }), id: 'n2', noteNo: 2 };
  assert.equal(nextNoteNo([INV, n1, n2]), 3);
  assert.equal(noteLabel(n2), 'AN-2');
  assert.equal(invoiceLabel(n2), 'Adjustment note AN-2');
  assert.equal(invoiceLabel(INV), 'Invoice #12');
  assert.equal(refLabel(INV), '#12');
  assert.equal(refLabel(n1), 'AN-1');
  assert.ok(isAdjustment(n1) && !isAdjustment(INV));
  assert.deepEqual(adjustmentsFor([INV, n2, n1], 'inv-1').map((n) => n.noteNo), [1, 2], 'in note order');
  assert.deepEqual(adjustmentsFor([INV, n1], 'other'), []);
});

check('what an invoice comes to after its notes', () => {
  const n1 = { ...buildAdjustment({ original: INV, amount: -550, issueDate: '2026-11-20' }), id: 'n1', noteNo: 1 };
  const n2 = { ...buildAdjustment({ original: INV, amount: 100, issueDate: '2026-11-21' }), id: 'n2', noteNo: 2 };
  const r = netPayable(INV, [INV, n1, n2]);
  assert.equal(r.invoiceTotal, 11000);
  assert.equal(r.adjustments, -450);
  assert.equal(r.net, 10550);
  assert.equal(netPayable(INV, [INV]).net, 11000);
});

check('an open credit takes its amount off what the buyer owes; settling it takes it out of the list', () => {
  const note = { ...buildAdjustment({ original: INV, amount: -550, issueDate: '2026-11-20' }), id: 'n1', noteNo: 1, invoiceNo: null, status: 'outstanding' };
  const open = receivables([INV, note], [SALE], '2026-11-25');
  assert.equal(open.outstanding.count, 2);
  assert.equal(open.outstanding.total, 10450, '11,000 less the 550 credit');
  assert.equal(open.overdue.total, 11000, 'only the invoice is overdue; the credit has no due date to age');
  const settled = receivables([INV, { ...note, status: 'paid' }], [SALE], '2026-11-25');
  assert.equal(settled.outstanding.total, 11000);
});

check('a buyer statement carries the note with its own number and nets it off', () => {
  const note = { ...buildAdjustment({ original: INV, amount: -550, issueDate: '2026-11-20' }), id: 'n1', noteNo: 1, invoiceNo: null, status: 'outstanding' };
  const [st] = buyerStatements([INV, note], [SALE], [], '2026-11-25');
  assert.equal(st.unpaidTotal, 10450);
  assert.ok(st.unpaid.some((r) => r.invoice.noteNo === 1));
  assert.ok(read('docs/js/statement.js').includes('refLabel(r.invoice)'));
});

check('the Xero invoice file leaves notes out; they have a file of their own with the note number', () => {
  const note = { ...buildAdjustment({ original: INV, amount: -550, reason: 'Quality discount', issueDate: '2026-11-20' }), id: 'n1', noteNo: 1, invoiceNo: null };
  const inv = xeroInvoices({ invoices: [INV, note], sales: [SALE], commodities: [], from: '2026-07-01', to: '2026-11-30' });
  assert.equal(inv.count, 1, 'only the tax invoice');
  assert.ok(inv.rows.every((r) => r['*InvoiceNumber'] === 12));
  const adj = xeroAdjustments({ invoices: [INV, note], sales: [SALE], from: '2026-07-01', to: '2026-11-30' });
  assert.equal(adj.count, 1);
  const row = adj.rows[0];
  assert.deepEqual(Object.keys(row), XERO_COLUMNS);
  assert.equal(row['*InvoiceNumber'], 'AN-1');
  assert.equal(row.Reference, 'Adjusts invoice 12');
  assert.equal(row['*UnitAmount'], -500);
  assert.equal(row['*TaxType'], 'GST on Income');
  assert.equal(row['*Description'], 'Quality discount');
  assert.equal(row['*InvoiceDate'], '20/11/2026');
  const none = xeroAdjustments({ invoices: [INV, note], sales: [SALE], from: '2026-11-21', to: '2026-11-30' });
  assert.equal(none.count, 0, 'picked by its own date');
});

check('a note is saved and read back with no invoice number and its own fields, through the server mapping', () => {
  const FARM = '11111111-1111-1111-1111-111111111111';
  const SID = '61616161-6161-6161-6161-616161616161';
  const NID = '71717171-7171-7171-7171-717171717171';
  const note = { ...buildAdjustment({ original: { ...INV, id: SID }, amount: -550, reason: 'Quality discount', issueDate: '2026-11-20' }), id: NID, noteNo: 4, invoiceNo: null, status: 'outstanding', paidDate: null };
  const state = { currentYear: '2026', nextMovementNo: 1, nextInvoiceNo: 13, businessDetails: {}, years: { 2026: { commodities: [], fields: [], storages: [], sales: [], movements: [], overheads: {}, invoices: [note] } } };
  const rows = stateToRows(state, FARM);
  assert.equal(rows.invoices[0].invoice_no, null);
  const back = rowsToState(rows).years[2026].invoices[0];
  assert.equal(back.kind, 'adjustment');
  assert.equal(back.noteNo, 4);
  assert.equal(back.adjustsInvoiceId, SID);
  assert.equal(back.adjustsInvoiceNo, 12);
  assert.equal(back.reason, 'Quality discount');
  assert.equal(back.totalPayable, -550);
  assert.equal(back.invoiceNo, null);
  assert.equal(back.dueDate, null);
});

check('the data layer, the invoice screens and the lists all know about notes', () => {
  const st = read('docs/js/storage.js');
  assert.ok(/createAdjustment\(note\)[\s\S]*?invoiceNo: null, noteNo: nextNoteNo\(all\)/.test(st), 'its own number, and the invoice number is left alone');
  const v = read('docs/js/views/invoice.js');
  assert.ok(v.includes('id="adj-new"') && v.includes('rctiAdjustment(invoice)') && v.includes('db.createAdjustment(note)'), 'made from the RCTI difference');
  assert.ok(v.includes('ADJUSTMENT NOTE') && v.includes('Adjusts invoice'), 'its own page');
  assert.ok(v.includes('if (isAdjustment(invoice)) { openAdjustmentDocSheet(sale, invoice); return; }'), 'a note opens as a note');
  assert.ok(read('docs/js/views/outstanding.js').includes('invoiceLabel(r.invoice)'));
  assert.ok(read('docs/js/eofy.js').includes('refLabel(r.invoice)'));
  assert.ok(read('docs/js/views/settings.js').includes("label: 'Adjustment note'"));
  assert.ok(/'kind', 'adjustsInvoiceId', 'adjustsInvoiceNo', 'noteNo', 'reason'/.test(read('docs/js/mapping.js')));
});

// ---- applied to the invoice: the invoice itself is corrected ----
const applied = () => {
  const note = { ...buildAdjustment({ original: INV, amount: -550, reason: 'Quality discount', issueDate: '2026-11-20', paymentTermsDays: 14, applyToInvoice: true }), id: 'n1', noteNo: 1, invoiceNo: null, status: 'paid', paidDate: '2026-11-20' };
  return { note, patch: applyAdjustment(INV, note) };
};

check('applying a note puts a line and its amounts on the invoice, which then comes to the RCTI total', () => {
  const { note, patch } = applied();
  assert.equal(note.appliedToInvoice, true);
  assert.equal(note.dueDate, null);
  assert.equal(patch.totalPayable, 10450, 'the same as their RCTI');
  assert.equal(patch.subtotalExGST, 9500);
  assert.equal(patch.gst, 950);
  const line = patch.lines.at(-1);
  assert.equal(line.isAdjustmentLine, true);
  assert.equal(line.noteId, 'n1');
  assert.equal(line.subtotal, -500);
  assert.equal(line.gst, -50);
  assert.ok(line.description.includes('AN-1') && line.description.includes('Quality discount'));
  const corrected = { ...INV, ...patch };
  assert.equal(rctiAdjustment(corrected), null, 'the invoice now agrees with the RCTI, so no further adjustment is offered');
});

check('applying the same note twice does not add its line or amount twice', () => {
  const { note, patch } = applied();
  const once = { ...INV, ...patch };
  const again = applyAdjustment({ ...once, lines: once.lines }, note);
  assert.equal(again.lines.filter((l) => l.noteId === 'n1').length, 1, 'one line');
});

check('a note applied to the invoice is not owed a second time', () => {
  const { note, patch } = applied();
  const corrected = { ...INV, ...patch };
  const r = receivables([corrected, note], [SALE], '2026-11-25');
  assert.equal(r.outstanding.count, 1, 'the settled note is not in the list');
  assert.equal(r.outstanding.total, 10450, 'the corrected invoice, once');
  const n = netPayable(corrected, [corrected, note]);
  assert.equal(n.invoiceTotal, 11000, 'the invoice as first issued, found by taking the note back out');
  assert.equal(n.adjustments, -550);
  assert.equal(n.net, 10450, 'not 9,900: the note is not taken off twice');
});

check('deleting an applied note takes its line and amounts back off the invoice', () => {
  const { note, patch } = applied();
  const corrected = { ...INV, ...patch };
  const back = withoutAdjustment(corrected, note);
  assert.equal(back.totalPayable, 11000);
  assert.equal(back.subtotalExGST, 10000);
  assert.equal(back.gst, 1000);
  assert.ok(!back.lines.some((l) => l.noteId === 'n1'));
  assert.deepEqual(withoutAdjustment(INV, note), {}, 'nothing to take back when the line is not there');
});

check('Xero gets the applied adjustment as a line of the invoice, and not as a note as well', () => {
  const { note, patch } = applied();
  const corrected = { ...INV, ...patch, lines: [{ date: '2026-11-01', rego: 'ABC', tons: 25, rate: 400, subtotal: 10000, movementId: 'm' }, ...patch.lines] };
  const inv = xeroInvoices({ invoices: [corrected, note], sales: [SALE], commodities: [], from: '2026-07-01', to: '2026-11-30' });
  assert.equal(inv.count, 1);
  const adjRow = inv.rows.find((r) => String(r['*Description']).includes('AN-1'));
  assert.ok(adjRow, 'the adjustment line');
  assert.equal(adjRow['*UnitAmount'], -500);
  assert.equal(adjRow['*TaxType'], 'GST on Income');
  assert.equal(xeroAdjustments({ invoices: [corrected, note], sales: [SALE], from: '2026-07-01', to: '2026-11-30' }).count, 0, 'not sent again as a note');
  const free = applyAdjustment(INV, { ...note, gst: 0, subtotalExGST: -550, totalPayable: -550 });
  const rowsFree = xeroInvoices({ invoices: [{ ...INV, lines: free.lines }], sales: [SALE], commodities: [], from: '', to: '' }).rows;
  assert.equal(rowsFree.find((r) => String(r['*Description']).includes('AN-1'))['*TaxType'], 'BAS Excluded', 'a levy or freight difference carries no GST');
});

check('the data layer applies and takes back, the form offers it, the invoice editor keeps it', () => {
  const st = read('docs/js/storage.js');
  assert.ok(/status: note\.appliedToInvoice \? 'paid' : 'outstanding'/.test(st), 'settled from the start');
  assert.ok(st.includes('Object.assign(original, applyAdjustment(original, inv))'), 'applied');
  assert.ok(st.includes('withoutAdjustment(original, gone)'), 'taken back when the note is deleted');
  assert.ok(st.includes('for (const n of notes) tombstone'), 'an invoice takes its notes with it');
  const v = read('docs/js/views/invoice.js');
  assert.ok(v.includes('id="adj-apply" checked') && v.includes('applyToInvoice: root.querySelector'), 'ticked by default');
  assert.ok(v.includes('adjustmentLines.reduce') && v.includes('lines.push(...adjustmentLines)'), 'editing the invoice keeps the adjustment lines and their amounts');
  assert.ok(/'noteNo', 'reason', 'appliedToInvoice'/.test(read('docs/js/mapping.js')));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
