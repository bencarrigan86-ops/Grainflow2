// Run with:
//   node tests/confirmationpdf.test.mjs
//
// The confirmation of sale as a PDF file that can be sent, not only printed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { confirmationPdf, termRows, CONFIRMATION_FOOTING } from '../docs/js/contractpdf.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${(e.stack || e.message).split('\n').slice(0, 3).join('\n        ')}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const asText = (bytes) => Array.from(bytes).map((b) => String.fromCharCode(b)).join('');

const sale = {
  id: 's1', contractNo: 'NSC-4501', date: '2026-11-03', buyer: 'Northbound Commodities', buyerAbn: '11 222 333 444', buyerContact: 'Jo Bloggs, 0400 111 222, jo@northbound.example',
  tons: 600, price: 368, freight: 21.5, grade: 'APW1', location: 'Delivered Newbridge', deliveryStart: '2027-01-05', deliveryEnd: '2027-02-28',
  paymentTermsDays: 30, notes: 'Quote the contract number on every ticket', cropYear: '2026',
};
const business = { entityName: 'Kurrajong Downs Pty Ltd', abn: '00 000 000 000', contactName: 'Sam Carrigan', phone: '0400 000 000', email: 'sam@example.com' };
const commodity = { id: 'wheat', name: 'Wheat', unit: 't' };
const when = '2026-11-17';

check('it is a real PDF with the title, the parties, the terms and the signing lines', () => {
  const bytes = confirmationPdf({ sale, business, commodity, date: when });
  const t = asText(bytes);
  assert.ok(t.startsWith('%PDF-1.4') && t.trim().endsWith('%%EOF'));
  for (const want of ['CONFIRMATION OF SALE', 'Kurrajong Downs Pty Ltd', 'Northbound Commodities', 'NSC-4501', 'Wheat', '$368.00 per tonne, exclusive of GST', '05-01-2027 to 28-02-2027', 'Signed', 'Prepared in Commodity Mate.']) {
    assert.ok(t.includes(want.replace(/[()\\]/g, (c) => `\\${c}`)), `has "${want}"`);
  }
  assert.ok(t.includes('Attn: Jo Bloggs') && t.includes('Email: jo@northbound.example'), 'the buyer contact');
});

check('the freight rate and the comments follow their tickboxes, as on the page', () => {
  const on = asText(confirmationPdf({ sale, business, commodity, date: when }));
  const off = asText(confirmationPdf({ sale, business, commodity, date: when, showFreight: false, showComments: false }));
  assert.ok(on.includes('21.50 per tonne') && on.includes('Quote the contract number'));
  assert.ok(!off.includes('21.50 per tonne') && !off.includes('Quote the contract number'));
});

check('the page and the PDF say the same thing: one list of terms, leaving out what is empty', () => {
  const rows = termRows(sale, commodity);
  const labels = rows.map(([l]) => l);
  assert.deepEqual(labels.slice(0, 5), ['Commodity', 'Grade', 'Quality', 'Quantity', 'Price']);
  assert.ok(!labels.includes('Broker') && !labels.includes('Carry'), 'nothing empty is printed');
  assert.ok(labels.includes('Trade rules'));
  assert.deepEqual(termRows(sale, commodity, { showFreight: false }).map(([l]) => l).includes('Freight'), false);
});

check('a long contract runs onto a second page rather than off the bottom', () => {
  const long = { ...sale, notes: 'A long condition that goes on. '.repeat(120), deliveryTerms: 'Delivered into the buyers site by the seller. '.repeat(30) };
  const t = asText(confirmationPdf({ sale: long, business, commodity, date: when }));
  assert.ok((t.match(/\/Type \/Page /g) || []).length >= 2);
});

check('a saved signature is drawn in place of the line to sign on, with the printed name and the date', () => {
  const signature = { strokes: [[[0, 0], [10, 6], [20, 2], [30, 9]]], name: 'Sam Carrigan' };
  const signed = asText(confirmationPdf({ sale, business, commodity, signature, date: when }));
  const plain = asText(confirmationPdf({ sale, business, commodity, date: when }));
  assert.ok(signed.length > plain.length && signed.includes(' S 0 G 0 J 0 j'), 'ink strokes are in it');
  assert.ok(signed.includes('Name  Sam Carrigan') && signed.includes('Date  17-11-2026'));
  assert.ok(!plain.includes('Date  17-11-2026'));
});

check('the confirmation sheet can share it, download it, and files a copy with the contract; it asks first when something is missing', () => {
  const c = read('docs/js/views/contract.js');
  assert.ok(c.includes('id="send-contract"') && c.includes('id="download-contract"') && c.includes('id="print-contract"'));
  assert.ok(c.includes('confirmationPdf({ sale, business, commodity, signature: signedWith, printedName'));
  assert.ok(c.includes("mail: { to: buyerContact.email, subject, body }"), "an email to the buyer is opened when this device cannot attach the file");
  assert.ok(c.includes("kind: 'confirmation'") && read('docs/js/documents.js').includes("value: 'confirmation'"));
  assert.ok(c.includes('Send it anyway?'));
  assert.ok(CONFIRMATION_FOOTING.startsWith('This confirmation records the agreement'));
  assert.ok(read('supabase/migrations/20261125000000_sale_document_confirmation.sql').includes("'confirmation'"));
});

check('a sheet set aside carries a class, so it is out of the printout too', () => {
  const ui = read('docs/js/ui.js');
  assert.ok(ui.includes("backdrop.classList.add('held')") && ui.includes("back.backdrop.classList.remove('held')"));
  assert.ok(read('docs/css/styles.css').includes('.sheet-backdrop.held { display: none !important; }'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
