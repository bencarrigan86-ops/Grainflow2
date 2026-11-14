// Run with:
//   node tests/vendordec.test.mjs
//
// The vendor declaration: the PDF writer, how a declaration is filled in from a contract or an order, and the
// helpers that send it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pdf, textWidth, wrapText } from '../docs/js/pdf.js';
import {
  buildDeclaration, declarationPdf, declarationProblems, deliveryPeriodText, emailIn, phoneIn, varietiesFor, documentId,
} from '../docs/js/vendordec.js';
import { safeFileName, mailtoLink } from '../docs/js/sharefile.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';
import { cleanStrokes, hasSignature, strokesToText, strokesFromText, strokesToSvgPath, strokesInBox } from '../docs/js/signature.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures += 1; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const latin1 = (bytes) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

console.log('=== the PDF writer ===');

check('a file starts and ends like a PDF, and its table of contents points at its objects', () => {
  const pdf = new Pdf();
  pdf.text(40, 40, 'Hello (world)', { size: 12, bold: true });
  pdf.rect(40, 60, 100, 20).line(40, 90, 200, 90).checkbox(40, 100, 9, true);
  const s = latin1(pdf.bytes());
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  const start = Number(/startxref\n(\d+)/.exec(s)[1]);
  assert.ok(s.slice(start).startsWith('xref'));
  const offsets = [...s.slice(start).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
  assert.ok(offsets.length >= 5);
  offsets.forEach((off, i) => assert.ok(s.slice(off).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
});
check('brackets and backslashes in text are escaped so they cannot end the string early', () => {
  const pdf = new Pdf();
  pdf.text(10, 10, 'a (b) \\ c');
  assert.ok(latin1(pdf.bytes()).includes('(a \\(b\\) \\\\ c) Tj'));
});
check('typographic characters become their Windows-1252 bytes; unknown ones a question mark', () => {
  const pdf = new Pdf();
  pdf.text(10, 10, 'it’s – ok ☃');
  const s = latin1(pdf.bytes());
  assert.ok(s.includes(`(it${String.fromCharCode(146)}s ${String.fromCharCode(150)} ok ?) Tj`));
});
check('text is measured and wrapped to a width', () => {
  assert.ok(textWidth('Hello', 10) > 20 && textWidth('Hello', 10) < 40);
  assert.ok(textWidth('Hello', 10, true) > textWidth('Hello', 10));
  const lines = wrapText('one two three four five six seven eight nine ten', 80, 10);
  assert.ok(lines.length > 2);
  lines.forEach((l) => assert.ok(textWidth(l, 10) <= 80.01, l));
  assert.deepEqual(wrapText('', 80), ['']);
  const cut = wrapText('Supercalifragilisticexpialidocious', 60, 10);
  assert.ok(cut.length > 1 && cut.every((l) => textWidth(l, 10) <= 60.01));
});
check('a second page makes a second page object', () => {
  const pdf = new Pdf();
  pdf.addPage().text(10, 10, 'two');
  assert.match(latin1(pdf.bytes()), /\/Count 2/);
});

console.log('\n=== filling in a declaration ===');

const SALE = {
  id: 's1', commodityId: 'c1', buyer: 'Riverina Grain Traders', contractNo: 'RGT-4471', tons: 1200,
  buyerAddress: '12 Silo Rd, Wagga NSW', buyerContact: 'Sam Buyer 0412 345 678 sam@riverina.example.com',
  deliveryStart: '2026-11-01', deliveryEnd: '2026-12-20',
};
const ORDER = { id: 'o1', saleId: 's1', orderNo: 'B-77', tons: 300, deliverFrom: '2026-11-10', deliverBy: '2026-11-30' };
const BUSINESS = { entityName: 'Carrigan Ag Pty Ltd', contactName: 'Ben Carrigan', phone: '0400 111 222', email: 'ben@example.com', address: '1 Farm Lane', ngr: '1234567' };
const FIELDS = [
  { commodityId: 'c1', seedVariety: 'Scepter' }, { commodityId: 'c1', seedVariety: 'scepter' },
  { commodityId: 'c2', seedVariety: 'Hyola' }, { commodityId: 'c1', seedVariety: 'Mace' }, { commodityId: 'c1', seedVariety: '' },
];
const make = (order = null, extra = {}) => buildDeclaration({ sale: SALE, order, business: BUSINESS, commodityName: 'Wheat', fields: FIELDS, today: '2026-11-14', ...extra });

check('the contract fills in the buyer, the grain, the dates and the vendor', () => {
  const d = make();
  assert.equal(d.buyer.company, 'Riverina Grain Traders');
  assert.equal(d.buyer.email, 'sam@riverina.example.com');
  assert.equal(d.buyer.tel, '0412 345 678');
  assert.equal(d.buyer.name, 'Sam Buyer');
  assert.equal(d.commodity, 'Wheat');
  assert.equal(d.contractNo, 'RGT-4471');
  assert.equal(d.deliveryFrom, '2026-11-01');
  assert.equal(d.deliveryTo, '2026-12-20');
  assert.equal(d.vendor.company, 'Carrigan Ag Pty Ltd');
  assert.equal(d.vendor.ngr, '1234567');
  assert.equal(d.signedDate, '2026-11-14');
});
check('an order narrows the tonnes and the dates; the rest stays with the contract', () => {
  const d = make({ ...ORDER });
  assert.equal(d.orderId, 'o1');
  assert.equal(d.deliveryFrom, '2026-11-10');
  assert.equal(d.deliveryTo, '2026-11-30');
  assert.equal(d.contractNo, 'RGT-4471');
  assert.equal(d.documentId, 'VD-B77-20261114');
});
check('varieties are the distinct seed varieties of that commodity; one variety takes all the tonnes', () => {
  assert.deepEqual(varietiesFor(FIELDS, 'c1'), ['Scepter', 'Mace']);
  const two = make();
  assert.deepEqual(two.varieties, [{ name: 'Scepter', tons: '' }, { name: 'Mace', tons: '' }]);
  const one = make({ ...ORDER }, { fields: [{ commodityId: 'c1', seedVariety: 'Scepter' }] });
  assert.deepEqual(one.varieties, [{ name: 'Scepter', tons: 300 }]);
  const none = make(null, { fields: [] });
  assert.deepEqual(none.varieties, [{ name: '', tons: 1200 }], 'a blank row takes the tonnes');
});
check('an email and a phone number are found in a contact line', () => {
  assert.equal(emailIn('call Jo on 0400 000 000 or jo@x.com.au please'), 'jo@x.com.au');
  assert.equal(phoneIn('Jo 0400 000 000 jo@x.com.au'), '0400 000 000');
  assert.equal(emailIn('no address here'), '');
  assert.equal(phoneIn(''), '');
});
check('a QA program saved with the business makes the declaration start on the QA basis', () => {
  assert.equal(make().basis, 'declared');
  const d = make(null, { business: { ...BUSINESS, qaProgram: 'Graincorp QA', qaNumber: 'QA-1' } });
  assert.equal(d.basis, 'qa');
  assert.equal(d.qaNumber, 'QA-1');
});
check('the delivery period reads as day-month-year, from, to or both', () => {
  assert.equal(deliveryPeriodText({ deliveryFrom: '2026-11-01', deliveryTo: '2026-12-20' }), '01-11-2026 to 20-12-2026');
  assert.equal(deliveryPeriodText({ deliveryFrom: '2026-11-01' }), 'from 01-11-2026');
  assert.equal(deliveryPeriodText({ deliveryTo: '2026-12-20' }), 'by 20-12-2026');
  assert.equal(deliveryPeriodText({}), '');
});
check('what would send it back is listed: a treatment not accounted for, a missing name', () => {
  assert.deepEqual(declarationProblems(make()), []);
  const d = make();
  d.seedUntreated = false;
  assert.ok(declarationProblems(d).some((p) => /seed treatment/i.test(p)));
  d.chemicals = [{ product: 'Gaucho', rate: '', date: '' }];
  assert.equal(declarationProblems(d).length, 0);
  const blank = make();
  blank.buyer.company = ''; blank.buyer.name = ''; blank.signedBy = '';
  assert.ok(declarationProblems(blank).some((p) => /buyer/i.test(p)));
  assert.ok(declarationProblems(blank).some((p) => /signs/i.test(p)));
  const qa = make();
  qa.basis = 'qa';
  assert.ok(declarationProblems(qa).some((p) => /quality assurance/i.test(p)));
});
check('the document id is the same for the same order and day', () => {
  assert.equal(documentId({ sale: SALE, order: null, date: '2026-11-14' }), 'VD-RGT4471-20261114');
  assert.equal(documentId({ sale: {}, order: null, date: '2026-11-14' }), 'VD-DEC-20261114');
});

console.log('\n=== the declaration as a PDF ===');

check('it comes out as one PDF page with the details on it', () => {
  const d = make();
  d.basis = 'declared'; d.seedUntreated = false;
  d.chemicals = [{ product: 'Gaucho 600', rate: '200 mL/100 kg', date: '2026-05-02' }];
  const s = latin1(declarationPdf(d));
  assert.ok(s.startsWith('%PDF'));
  assert.match(s, /\/Count 1/);
  for (const text of ['GRAIN COMMODITY VENDOR DECLARATION', 'Riverina Grain Traders', 'RGT-4471', 'Gaucho 600', '02-05-2026', '01-11-2026 to 20-12-2026']) {
    assert.ok(s.includes(text), text);
  }
});
check('a long list of chemicals runs on to a second page rather than off the bottom', () => {
  const d = make();
  d.basis = 'declared'; d.notFumigated = false;
  d.chemicals = Array.from({ length: 30 }, (_v, i) => ({ product: `Chemical ${i + 1}`, rate: '1 L/ha', date: '2026-06-01' }));
  assert.match(latin1(declarationPdf(d)), /\/Count [2-9]/);
});

console.log('\n=== sending it ===');

check('a file name is made safe', () => {
  assert.equal(safeFileName('Vendor declaration RGT/4471: final?'), 'Vendor declaration RGT4471 final.pdf');
  assert.equal(safeFileName('already.pdf'), 'already.pdf');
  assert.equal(safeFileName(''), 'document.pdf');
});
check('the email link carries the address, subject and message', () => {
  const link = mailtoLink({ to: 'sam@riverina.example.com', subject: 'Vendor declaration - contract 1', body: 'Hi Sam,\n\nthanks' });
  assert.ok(link.startsWith('mailto:sam@riverina.example.com?'));
  assert.ok(link.includes('subject=Vendor%20declaration%20-%20contract%201'));
  assert.ok(link.includes('body=Hi%20Sam%2C%0A%0Athanks'));
  assert.equal(mailtoLink({}), 'mailto:');
});

console.log('\n=== a saved signature ===');

const SIG = [[[0.1, 0.5], [0.3, 0.2], [0.5, 0.8], [0.9, 0.4]], [[0.2, 0.9]]];
check('strokes are tidied: out-of-range points held in the box, junk and near-duplicate points dropped', () => {
  const clean = cleanStrokes([[[-1, 2], [0.5, 0.5], [0.5004, 0.5003], ['x', 1], null], [], 'nope', [[0.2, 0.2]]]);
  assert.deepEqual(clean, [[[0, 1], [0.5, 0.5]], [[0.2, 0.2]]]);
  assert.deepEqual(cleanStrokes('not strokes'), []);
  assert.equal(hasSignature([]), false);
  assert.equal(hasSignature([[]]), false);
  assert.equal(hasSignature(SIG), true);
});
check('a signature goes to text and comes back the same; damaged text is no signature', () => {
  assert.deepEqual(strokesFromText(strokesToText(SIG)), cleanStrokes(SIG));
  assert.equal(strokesToText([]), '');
  assert.deepEqual(strokesFromText('{not json'), []);
  assert.deepEqual(strokesFromText(''), []);
});
check('there is a limit on how much can be kept', () => {
  const huge = Array.from({ length: 100 }, (_a, i) => Array.from({ length: 100 }, (_b, j) => [(i % 10) / 10 + j / 2000, j / 100]));
  assert.ok(cleanStrokes(huge).reduce((n, st) => n + st.length, 0) <= 1500);
});
check('it can be drawn on screen (an svg path) and placed in a box on a page', () => {
  assert.equal(strokesToSvgPath(SIG, 150), 'M15 25L45 10L75 40L135 20 M30 45l0.1 0');
  const placed = strokesInBox(SIG, 100, 200, 120, 40);
  assert.deepEqual(placed[0][0], [112, 220]);
  assert.deepEqual(placed[0][3], [208, 216]);
});
check("the declaration is signed with the signer's own signature, and left for a hand signature otherwise", () => {
  const signed = make(null, { signature: { strokes: SIG, name: 'Ben C.' } });
  assert.equal(signed.useSignature, true);
  assert.equal(signed.signedBy, 'Ben C.');
  const unsigned = make();
  assert.equal(unsigned.useSignature, false);
  assert.equal(unsigned.signedBy, 'Ben Carrigan');
  const count = (d) => (latin1(declarationPdf(d)).match(/ l /g) || []).length;
  assert.ok(count(signed) > count({ ...signed, useSignature: false }), 'the strokes are drawn');
});
check('our contract number and the delivery address are carried through to the PDF', () => {
  const d = buildDeclaration({ sale: { ...SALE, ourRef: 'C-26-014', location: 'Newbridge Receival Site' }, business: BUSINESS, commodityName: 'Wheat', fields: [], today: '2026-11-14' });
  assert.equal(d.ourContractNo, 'C-26-014');
  assert.equal(d.contractNo, 'RGT-4471');
  assert.equal(d.deliveryAddress, 'Newbridge Receival Site');
  const s = latin1(declarationPdf(d));
  for (const text of ['C-26-014', 'RGT-4471', 'Newbridge Receival Site', 'Our Contract No:']) assert.ok(s.includes(text), text);
});
check('our contract number is saved with the contract and read back', () => {
  const FARM = '11111111-1111-1111-1111-111111111111';
  const sale = { id: 's9', commodityId: 'c1', buyer: 'B', tons: 10, ourRef: 'C-26-014', __hasOurRef: true };
  const state = { currentYear: '2026', nextMovementNo: 1, businessDetails: {}, years: { 2026: { commodities: [{ id: 'c1', name: 'Wheat' }], storages: [], fields: [], sales: [sale], movements: [], overheads: {}, invoices: [] } } };
  const rows = stateToRows(state, FARM);
  assert.equal(rows.sales[0].our_ref, 'C-26-014');
  assert.equal(rowsToState(rows).years[2026].sales[0].ourRef, 'C-26-014');
});

console.log('\n=== the QA program is saved with the business ===');

check('it is stored on the farm row once it is filled in, and read back', () => {
  const FARM = '11111111-1111-1111-1111-111111111111';
  const state = (bd) => ({ currentYear: '2026', nextMovementNo: 1, businessDetails: bd, years: { 2026: { commodities: [], storages: [], fields: [], sales: [], movements: [], overheads: {}, invoices: [] } } });
  assert.ok(!('qa_program' in stateToRows(state({}), FARM).farms[0]), 'not sent until it is set');
  const row = stateToRows(state({ qaProgram: 'Graincorp QA', qaNumber: 'QA-1' }), FARM).farms[0];
  assert.equal(row.qa_program, 'Graincorp QA');
  assert.equal(row.qa_number, 'QA-1');
  const back = rowsToState(stateToRows(state({ qaProgram: 'Graincorp QA', qaNumber: 'QA-1' }), FARM)).businessDetails;
  assert.equal(back.qaProgram, 'Graincorp QA');
  assert.equal(back.qaNumber, 'QA-1');
  const cleared = stateToRows(state({ qaProgram: '', qaNumber: '', __hasQa: true }), FARM).farms[0];
  assert.equal(cleared.qa_program, null, 'clearing it reaches the server');
});

console.log('\n=== wired in ===');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
check('the contract and the order each have a Vendor declaration button', () => {
  assert.match(read('docs/js/views/sales.js'), /id="make-vendordec"/);
  assert.match(read('docs/js/views/sales.js'), /openVendorDecSheet\(\{ saleId: existing\.id \}\)/);
  assert.match(read('docs/js/views/orders.js'), /openVendorDecSheet\(\{ orderId: existing\.id \}\)/);
});
check('the database columns and the signature table are in the paste-in file, one row each person only', () => {
  const sql = read('supabase/paste-into-sql-editor.sql');
  assert.match(sql, /add column if not exists qa_program text/);
  assert.match(sql, /add column if not exists qa_number text/);
  assert.match(sql, /add column if not exists our_ref text/);
  assert.match(sql, /check \(kind in \('contract', 'broker_note', 'vendor_dec', 'other'\)\)/);
  assert.match(sql, /create table if not exists user_signatures/);
  assert.match(sql, /user_signatures_select on user_signatures\s+for select to authenticated using \(user_id = auth\.uid\(\)\)/);
});
check('a sent declaration is filed with the contract, as a document kind the contract knows', () => {
  assert.match(read('docs/js/documents.js'), /value: 'vendor_dec'/);
  assert.match(read('docs/js/views/vendordec.js'), /fileSentCopy\(/);
  assert.match(read('docs/js/sentcopy.js'), /uploadSaleDocument/);
});
check('the signature belongs to the person: Settings opens it, and the farm rows never carry it', () => {
  assert.match(read('docs/js/views/settings.js'), /openMySignatureSheet\(/);
  assert.ok(!/signature/i.test(read('docs/js/mapping.js')), 'nothing about signatures in the farm mapping');
  assert.match(read('docs/js/mysignature.js'), /from\('user_signatures'\)/);
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
