// Run with:
//   node tests/sheethold.test.mjs
//
// A sheet opened from another sheet (the confirmation of sale from a contract, a load from an invoice) sets the first one aside and
// gives it back when it is closed, so nobody is dropped out to the tab they started from.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${(e.stack || e.message).split('\n').slice(0, 3).join('\n        ')}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// the smallest page that openSheet can run on
const el = () => {
  const e = {
    children: [], style: {}, className: '', parent: null, listeners: {}, removed: false, _html: '',
    appendChild(c) { this.children.push(c); c.parent = this; return c; },
    remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
    setAttribute() {},
    classList: { add() {}, remove() {} },
    querySelector() { return el(); },
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html; },
  };
  return e;
};
globalThis.document = { body: el(), createElement: () => el() };

const { openSheet, closeSheet, holdSheet, openOver, isSheetOpen } = await import('../docs/js/ui.js');
const shown = () => document.body.children.filter((c) => c.style.display !== 'none');
const titleOf = (b) => b.children[0]._html.match(/<h2>(.*?)<\/h2>/)?.[1];

await check('a sheet opened over another sets it aside, and closing it gives the first back as it was', () => {
  openSheet('Contract', () => {});
  const contract = document.body.children[0];
  openOver(() => openSheet('Confirmation of sale', () => {}));
  assert.equal(document.body.children.length, 2, 'the contract is kept, not thrown away');
  assert.equal(contract.style.display, 'none', 'and out of sight');
  assert.equal(titleOf(shown()[0]), 'Confirmation of sale');
  closeSheet();
  assert.equal(document.body.children.length, 1);
  assert.equal(document.body.children[0], contract);
  assert.notEqual(contract.style.display, 'none', 'the contract is back on the screen');
  assert.equal(isSheetOpen(), true);
  closeSheet();
  assert.equal(document.body.children.length, 0);
  assert.equal(isSheetOpen(), false);
});

await check('the sheet that comes back is told, so it can show what changed meanwhile', () => {
  let told = 0;
  openSheet('Invoice', () => {});
  openOver(() => openSheet('Edit load', () => {}), () => { told += 1; });
  assert.equal(told, 0);
  closeSheet();
  assert.equal(told, 1);
  closeSheet();
});

await check('a sheet that replaces another, the way saving a form opens its document, still replaces it', () => {
  openSheet('Builder', () => {});
  openSheet('Invoice', () => {});
  assert.equal(document.body.children.length, 1);
  closeSheet();
  assert.equal(document.body.children.length, 0);
});

await check('a sheet that replaces the one on top still hands back to the one underneath', () => {
  openSheet('Contract', () => {});
  const contract = document.body.children[0];
  openOver(() => openSheet('Invoices', () => {}));
  openSheet('Invoice #12', () => {});
  assert.equal(document.body.children.length, 2);
  closeSheet();
  assert.equal(document.body.children[0], contract);
  assert.notEqual(contract.style.display, 'none');
  closeSheet();
});

await check('with no sheet open there is nothing to set aside, and the next sheet just opens', () => {
  assert.equal(holdSheet(), false);
  openOver(() => openSheet('Alone', () => {}));
  assert.equal(document.body.children.length, 1);
  closeSheet();
  assert.equal(document.body.children.length, 0);
});

await check('sheets set aside come back one at a time, the most recent first', () => {
  const order = [];
  openSheet('One', () => {});
  openOver(() => openSheet('Two', () => {}), () => order.push('one'));
  openOver(() => openSheet('Three', () => {}), () => order.push('two'));
  closeSheet();
  closeSheet();
  closeSheet();
  assert.deepEqual(order, ['two', 'one']);
  assert.equal(document.body.children.length, 0);
});

await check('the contract hands itself over for its PDF, invoices, vendor declaration and loads; so do the other screens that open a sheet from a sheet', () => {
  const sales = read('docs/js/views/sales.js');
  assert.ok(sales.includes('openOver(() => openContractDocSheet(fresh))'), 'the confirmation of sale');
  assert.ok(sales.includes('openOver(() => openInvoiceListSheet(existing))'), 'the invoices');
  assert.ok(sales.includes('openOver(() => openVendorDecSheet({ saleId: existing.id }))'), 'the vendor declaration');
  const moves = read('docs/js/views/movements.js');
  assert.ok(moves.includes('openOver(() => openMovementSheet(related.find'), 'a load from the related list on a contract, silo or paddock');
  for (const f of ['orders', 'freightorders']) assert.ok(read(`docs/js/views/${f}.js`).includes('openOver(() => openMovementSheet(against.find'), `a load from ${f}`);
  assert.ok(read('docs/js/views/outstanding.js').includes('openOver(() => openInvoiceListSheet('), 'invoices from receivables');
  assert.ok(read('docs/js/views/settings.js').includes('openOver(() => openLoadImportSheet())'), 'the import sheets');
  assert.ok(read('docs/js/views/production.js').includes('openOver(() => openRotationSheet())'), 'the reports');
});

await check('an invoice can open a load to correct it, and comes back with the loads and totals worked out again', () => {
  const inv = read('docs/js/views/invoice.js');
  assert.ok(inv.includes('class="link-btn ld-open"') && inv.includes('Edit this load'));
  assert.ok(inv.includes('openOver(() => openMovementSheet(load)'));
  const back = inv.slice(inv.indexOf('openOver(() => openMovementSheet(load)'));
  assert.ok(back.includes('available = movementsForEndpoint') && back.includes('paintLoads(keepNow)') && back.includes('recomputeTotals()'), 'the loads are read again and the totals recomputed');
  assert.ok(inv.includes('readKeep') && inv.includes('keep.checked.has(m.id)'), 'what was ticked stays ticked');
});

await check('the invoice and the adjustment note carry the farm letterhead on the green band, with the green carried through the tables', () => {
  const inv = read('docs/js/views/invoice.js');
  assert.equal((inv.match(/<div class="invoice-doc branded">/g) || []).length, 3, 'the grain invoice, the cotton invoice and the adjustment note');
  assert.ok(inv.includes("title: 'TAX INVOICE'") && inv.includes("title: 'ADJUSTMENT NOTE'"));
  const css = read('docs/css/styles.css');
  assert.ok(css.includes('.invoice-doc.branded .table-scroll table th { background: #2e7d32'));
  assert.ok(css.includes('.invoice-doc .doc-band-from'));
});

await check('the payment details print one to a line, on the invoice and on a charging adjustment note, and only what has been entered', () => {
  const inv = read('docs/js/views/invoice.js');
  assert.ok(inv.includes("['Bank', business.bankName], ['Account name', business.accountName], ['BSB', business.bsb], ['Account number', business.accountNumber]"));
  assert.ok(inv.includes('.filter(([, v]) => String(v ?? \'\').trim())'), 'a blank detail has no line');
  assert.ok(inv.includes('      ${bankDetailsHTML(business)}'), 'on the invoice');
  assert.ok(inv.includes("${credit ? '' : bankDetailsHTML(business)}"), 'on an adjustment note that charges, not on a credit');
  assert.ok(!inv.includes('Acc ${esc(business.accountNumber)}'), 'the one-line version is gone');
  assert.ok(read('docs/css/styles.css').includes('.invoice-doc .bank-row {'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
