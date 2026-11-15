// Run with:
//   node tests/signdoc.test.mjs
//
// Signing a confirmation of sale, an invoice and a freight order with the signed-in person's saved signature.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inkSvg, signedBlockHTML, canSign, signerName } from '../docs/js/signdoc.js';
import { freightOrderPdf } from '../docs/js/freight.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const SIG = { strokes: [[[0.1, 0.5], [0.4, 0.2], [0.9, 0.7]]], name: 'Ben <Carrigan>' };

console.log('\n=== the picture and the block ===');
check('a signature is drawn as a dark path; nothing drawn gives nothing', () => {
  assert.match(inkSvg(SIG.strokes), /<svg[^>]*><path d="M/);
  assert.equal(inkSvg([]), '');
  assert.equal(inkSvg(null), '');
});
check('the signed block carries the name and the date, escaped', () => {
  const h = signedBlockHTML(SIG, { date: '15-11-2026', role: 'Seller' });
  assert.match(h, /Seller signed/);
  assert.match(h, /Ben &lt;Carrigan&gt; &middot; 15-11-2026/);
  assert.doesNotMatch(h, /<Carrigan>/);
});
check('no signature, no block', () => {
  assert.equal(signedBlockHTML(null), '');
  assert.equal(signedBlockHTML({ strokes: [] }), '');
  assert.equal(canSign(null), false);
  assert.equal(canSign(SIG), true);
});
check('the printed name is the one saved with the signature, else the business contact', () => {
  assert.equal(signerName({ ...SIG, name: 'B C' }, { contactName: 'Other' }), 'B C');
  assert.equal(signerName({ strokes: SIG.strokes, name: '' }, { contactName: 'Other' }), 'Other');
  assert.equal(signerName(null, {}), '');
});

console.log('\n=== the freight order PDF ===');
const args = { fo: { freightNo: 'F1', carrier: 'Acme', tons: 100, rateBasis: 'tonne', rate: 10 }, sale: { buyer: 'B' }, business: { entityName: 'Farm' }, issuedBy: 'Ben', date: '2026-11-15' };
const text = (b) => Buffer.from(b).toString('latin1');
check('a signed order has the ink on it and an unsigned one does not', () => {
  const plain = freightOrderPdf(args);
  const signed = freightOrderPdf({ ...args, signature: SIG });
  assert.ok(signed.length > plain.length, 'the signature adds drawing');
  assert.match(text(signed), /Issued by Ben, 15-11-2026/);
  assert.doesNotMatch(text(plain), /Issued by Ben, /);
});

console.log('\n=== the screens ===');
check('the confirmation, invoice and freight order each offer the tickbox and use the saved signature', () => {
  for (const f of ['docs/js/views/contract.js', 'docs/js/views/invoice.js']) {
    const s = read(f);
    assert.match(s, /signToggleHtml\('sign-doc'/, f);
    assert.match(s, /wireSignToggle\(root, 'sign-doc'/, f);
    assert.match(s, /signedBlockHTML/, f);
  }
  const fo = read('docs/js/views/freightorders.js');
  assert.match(fo, /signToggleHtml\('fo-sign'/);
  assert.match(fo, /signature: mySig/);
});
check('the tickbox is not printed with the document', () => {
  const css = read('docs/css/styles.css');
  assert.match(css, /@media print[\s\S]*\.doc-actions/);
  assert.match(read('docs/js/views/contract.js'), /<div class="doc-actions">\$\{signToggleHtml/);
  assert.match(read('docs/js/views/invoice.js'), /<div class="doc-actions">\$\{signToggleHtml/);
});

console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
process.exit(failures ? 1 : 0);
