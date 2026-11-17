// Run with:
//   node tests/branding.test.mjs
//
// The farm's logo on the PDFs, the buyer's contact as three boxes, "Seller's option", and the confirmation of sale.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSION } from '../docs/js/version.js';
const stamp = APP_VERSION.split('.').pop();
const { Pdf } = await import(`../docs/js/pdf.js?v=${stamp}`);
const { jpegInfo, setBrandLogo, brandLogo, logoSize, drawBrandLogo } = await import(`../docs/js/brand.js?v=${stamp}`);
const { fitWithin } = await import(`../docs/js/logo.js?v=${stamp}`);
const { splitContact, joinContact, contactLines } = await import(`../docs/js/buyercontact.js?v=${stamp}`);
const { PATTERNS, PATTERN_ON_CONTRACT } = await import(`../docs/js/deliveryplan.js?v=${stamp}`);
const { parseSigners, signerChoices } = await import(`../docs/js/signdoc.js?v=${stamp}`);
const { exposurePdf } = await import(`../docs/js/exposurepdf.js?v=${stamp}`);
const { statementPdf } = await import(`../docs/js/statement.js?v=${stamp}`);
const { declarationPdf, buildDeclaration } = await import(`../docs/js/vendordec.js?v=${stamp}`);
const { stateToRows, rowsToState } = await import(`../docs/js/mapping.js?v=${stamp}`);

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const text = (bytes) => Buffer.from(bytes).toString('latin1');

// a one pixel JPEG (the size is in its start-of-frame marker)
const TINY = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const WIDE = (() => { // the same file with its size changed to 300 x 100 (the writer only reads the marker)
  const b = Buffer.from(TINY.split(',')[1], 'base64');
  const at = b.indexOf(Buffer.from([0xFF, 0xC2]));
  b.writeUInt16BE(100, at + 5); b.writeUInt16BE(300, at + 7);
  return 'data:image/jpeg;base64,' + b.toString('base64');
})();

console.log('\n=== the logo ===');
check('a JPEG data address gives its size, and anything else gives nothing', () => {
  const i = jpegInfo(TINY);
  assert.equal(i.width, 1); assert.equal(i.height, 1);
  assert.equal(jpegInfo(WIDE).width, 300);
  assert.equal(jpegInfo(''), null);
  assert.equal(jpegInfo('data:image/png;base64,AAAA'), null);
  assert.equal(jpegInfo('data:image/jpeg;base64,AAAA'), null);
});
check('the logo is fitted in its own proportions, never enlarged by the picker', () => {
  const s = logoSize(jpegInfo(WIDE), 110, 46);
  assert.ok(Math.abs(s.w / s.h - 3) < 1e-9 && s.w <= 110 && s.h <= 46);
  assert.deepEqual(fitWithin(960, 480), { width: 480, height: 240 });
  assert.deepEqual(fitWithin(100, 50), { width: 100, height: 50 });
  assert.deepEqual(fitWithin(1000, 100), { width: 480, height: 48 });
});
check('with no logo set, nothing is drawn and a PDF is unchanged; with one, the picture is in the file', () => {
  setBrandLogo('');
  assert.equal(brandLogo(), null);
  const plain = new Pdf(); assert.equal(drawBrandLogo(plain, { right: 500, top: 10 }), 500);
  assert.ok(!text(plain.bytes()).includes('/Subtype /Image'));
  setBrandLogo(WIDE);
  const p = new Pdf();
  const edge = drawBrandLogo(p, { right: 500, top: 10, tile: true });
  assert.ok(edge < 500, 'the text beside it is told where to stop');
  const s = text(p.bytes());
  assert.ok(s.includes('/Subtype /Image') && s.includes('/Filter /DCTDecode') && s.includes('/Width 300') && s.includes('/Im0 Do'));
  assert.ok(s.includes('/XObject <<'), 'the page lists the picture');
  assert.ok(s.startsWith('%PDF-1.4') && s.trimEnd().endsWith('%%EOF'));
});
check('every kind of PDF carries the logo when one is set, and none when not', () => {
  const st = { buyer: 'Riverina', unpaid: [], notInvoiced: [], owing: 0, unpaidTotal: 0, notInvoicedTons: 0, notInvoicedValue: 0 };
  const decl = buildDeclaration({ sale: { buyer: 'Riverina', tons: 100 }, business: { entityName: 'Test Farm' }, commodityName: 'Wheat', fields: [], today: '2026-11-16' });
  const makers = {
    exposure: () => exposurePdf({ buyers: [], total: {}, weeks: [] }),
    statement: () => statementPdf(st, { today: '2026-11-16' }),
    vendordec: () => declarationPdf(decl),
  };
  for (const [name, make] of Object.entries(makers)) {
    setBrandLogo(WIDE);
    let withLogo = ''; try { withLogo = text(make()); } catch (e) { assert.fail(`${name}: ${e.message}`); }
    setBrandLogo('');
    const without = text(make());
    assert.ok(withLogo.includes('/Subtype /Image'), name + ' has the logo');
    assert.ok(!without.includes('/Subtype /Image'), name + ' has none without one');
  }
  setBrandLogo('');
});
check('every PDF module asks for the logo in its header', () => {
  for (const f of ['averagespdf', 'fertpdf', 'exposurepdf', 'reportpdf', 'positionpdf', 'seedpdf', 'statement', 'loadreport', 'rotationexport', 'eofy', 'freight', 'vendordec']) {
    assert.ok(read(`docs/js/${f}.js`).includes('drawBrandLogo('), f);
  }
});
check('the logo is kept with the farm: saved, sent once there is one, read back, and handed to the PDF writer', () => {
  const m = read('docs/js/mapping.js');
  assert.ok(m.includes('logo: orNull(b.logo)') && m.includes('farm.logo != null'));
  assert.ok(m.includes('logo_off: !!b.logoOff') && m.includes('farm.logo_off != null'), 'the on/off switch is kept with the farm');
  assert.ok(read('docs/js/storage.js').includes("setBrandLogo(data.businessDetails?.logoOff ? '' : data.businessDetails?.logo)"), 'a logo that is off is not handed to the PDFs');
  assert.ok(read('docs/js/views/settings.js').includes('id="bd-logo-on"') && read('docs/js/views/contract.js').includes('business.logo && !business.logoOff'));
  assert.ok(read('supabase/migrations/20261119000000_farm_logo.sql').includes('add column if not exists logo text'));
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('add column if not exists logo text'));
  const s = read('docs/js/views/settings.js');
  assert.ok(s.includes('id="bd-logo-file"') && s.includes('logoFromFile(file)') && s.includes('id="bd-logo-remove"'));
});

console.log('\n=== the buyer\'s contact ===');
check('a contact line is three things, and three things are one line', () => {
  assert.deepEqual(splitContact('Jane Smith, 0400 123 456, jane@buyer.com.au'), { name: 'Jane Smith', phone: '0400 123 456', email: 'jane@buyer.com.au' });
  assert.deepEqual(splitContact('Jane 0400 123 456'), { name: 'Jane', phone: '0400 123 456', email: '' });
  assert.deepEqual(splitContact('jane@buyer.com.au'), { name: '', phone: '', email: 'jane@buyer.com.au' });
  assert.deepEqual(splitContact(''), { name: '', phone: '', email: '' });
  assert.equal(joinContact({ name: 'Jane Smith', phone: '0400 123 456', email: 'jane@buyer.com.au' }), 'Jane Smith, 0400 123 456, jane@buyer.com.au');
  assert.equal(joinContact({ name: ' Jane ', phone: '', email: '' }), 'Jane');
  assert.equal(joinContact({}), '');
  const line = joinContact({ name: 'Jane Smith', phone: '07 4671 1234', email: 'j@b.com' });
  assert.deepEqual(splitContact(line), { name: 'Jane Smith', phone: '07 4671 1234', email: 'j@b.com' });
});
check('the confirmation prints the contact as name, number and email lines', () => {
  assert.deepEqual(contactLines('Jane Smith, 0400 123 456, jane@buyer.com.au'), ['Attn: Jane Smith', 'Ph: 0400 123 456', 'Email: jane@buyer.com.au']);
  assert.deepEqual(contactLines(''), []);
  const s = read('docs/js/views/sales.js');
  assert.ok(s.includes("id: 'contactName'") && s.includes("id: 'contactPhone'") && s.includes("id: 'contactEmail'") && s.includes('buyerContact: joinContact('));
});

console.log('\n=== how it is delivered ===');
check("Seller's option is a delivery option, kept with the contract, and printed on the confirmation", () => {
  assert.deepEqual(PATTERNS.map((p) => p.value), ['', 'call', 'sellers', 'even']);
  assert.deepEqual(PATTERN_ON_CONTRACT, { call: "Buyer's call", sellers: "Seller's option", even: 'Even spread over the delivery period' });
  const sale = { id: 's', deliveryPattern: 'sellers' };
  const rows = stateToRows({ currentYear: '2026', years: { 2026: { sales: [sale], commodities: [], fields: [], storages: [], movements: [] } }, businessDetails: {} }, 'farm1');
  assert.equal(rows.sales[0].delivery_pattern, 'sellers');
  assert.equal(rowsToState(rows).years[2026].sales[0].deliveryPattern, 'sellers');
});

console.log('\n=== the confirmation of sale ===');
check('it has the green band with the logo, the contact lines, the delivery option, the freight rate when ticked and the signer', () => {
  const c = read('docs/js/views/contract.js');   // the views reach the network, so they are read here rather than run
  assert.ok(c.includes('class="doc-band"') && c.includes('class="doc-band-logo"') && c.includes('business.logo'));
  assert.ok(c.includes('contactLines(sale.buyerContact)'));
  assert.ok(c.includes("term('Delivery option', PATTERN_ON_CONTRACT[sale.deliveryPattern])"));
  assert.ok(c.includes('showFreight && sale.freight'), 'the freight rate follows the tickbox');
  assert.ok(c.includes('signerName(signed?.sig, business)') && c.includes('<strong>${esc(sellerName)}</strong>'), "the seller's name is printed on the Name line");
  assert.ok(c.includes('signedBlockHTML({ ...signed.sig, name: sellerName }'), 'and under a signature');
});
check('the freight tickbox is on the print sheet, and the sheet prints once', () => {
  const c = read('docs/js/views/contract.js');
  assert.ok(c.includes('id="show-freight"') && c.includes('{ showFreight, printedName }'));
  const css = read('docs/css/styles.css');
  assert.ok(/@media print[\s\S]*\.sheet-backdrop \{ position: static/.test(css), 'the fixed overlay is made ordinary for printing, or every page repeats it');
  assert.ok(/@media print[\s\S]*body > \*:not\(\.sheet-backdrop\) \{ display: none/.test(css), 'the app underneath takes no room');
});


console.log('\n=== the printed name under a signature ===');
check("the names a document can be signed in: the signed-in person first, then the business's list, then its contact, each once", () => {
  assert.deepEqual(parseSigners('Ben Carrigan\nKara Carrigan, ben carrigan;  Jules Dewar'), ['Ben Carrigan', 'Kara Carrigan', 'Jules Dewar']);
  assert.deepEqual(parseSigners(''), []);
  assert.deepEqual(signerChoices({ mine: 'Kara Carrigan', signers: 'Ben Carrigan\nKara Carrigan', contactName: 'Ben Carrigan' }), ['Kara Carrigan', 'Ben Carrigan']);
  assert.deepEqual(signerChoices({ contactName: 'Ben' }), ['Ben']);
  assert.deepEqual(signerChoices({}), []);
});
check('every document that carries a signature prints a name under it, from the signed-in person or a dropdown', () => {
  const t = read('docs/js/views/signtoggle.js');
  assert.ok(t.includes('export function signerPickHtml') && t.includes('export async function wireSignerPick') && t.includes('export async function signerNamesFor'));
  for (const f of ['contract', 'invoice', 'freightorders']) {
    const v = read(`docs/js/views/${f}.js`);
    assert.ok(v.includes('signerPickHtml(') && v.includes('wireSignerPick(') && v.includes('printedName'), f);
  }
  for (const f of ['vendordec', 'spray']) assert.ok(read(`docs/js/views/${f}.js`).includes('dl-signers'), f);
  assert.ok(read('docs/js/views/settings.js').includes("id: 'bd-signers'"));
  assert.ok(read('docs/js/mapping.js').includes('signers: orNull(b.signers)') && read('supabase/migrations/20261119000000_farm_logo.sql').includes('signers text'));
});

console.log('');
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('All pass.');
