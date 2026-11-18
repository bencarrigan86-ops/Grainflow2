// Run with:
//   node tests/cottonkinds.test.mjs
//
// The four cotton contracts: a lint sale and a seed sale outright (both ordinary), gin for seed (the seed sold to the gin, the
// ginning netted off), and ginning only. The two with the gin are measured in standard bales ginned.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cottonKind, isGinContract, cleanCottonTerms, ginCostPerBale, netPerBale, ginCostFor, ginContracts, kindSummary } from '../docs/js/cottonkinds.js';
import { salesByCommodity, saleEconomics } from '../docs/js/derived.js';
import { termRows, ginTermsLines } from '../docs/js/contractpdf.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const here = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'js');
const src = (p) => readFileSync(join(here, p), 'utf8');

const terms = { ginRate: 75, researchLevy: 2.25, voluntaryLevy: 1.5, gstOnGin: true };
const forSeed = { id: 's1', commodityId: 'cotton', cottonKind: 'ginforseed', buyer: 'Bimbi Ginning', tons: 1350, price: 118, cottonTerms: terms };
const ginning = { id: 's2', commodityId: 'cotton', cottonKind: 'ginning', buyer: 'Bimbi Ginning', tons: 1500, price: 0, cottonTerms: terms };
const lint = { id: 's3', commodityId: 'cotton', buyer: 'Wattle', tons: 600, price: 570 };

console.log('\n=== the kinds ===');
check('a contract is a lint sale unless it says it is with the gin', () => {
  assert.equal(cottonKind(lint), 'lint');
  assert.equal(cottonKind({ cottonKind: 'rubbish' }), 'lint');
  assert.equal(cottonKind(forSeed), 'ginforseed');
  assert.equal(isGinContract(lint), false);
  assert.equal(isGinContract(ginning), true);
});
check('the gin charges: ginning and both levies, per bale', () => {
  assert.equal(ginCostPerBale(forSeed), 78.75);
  assert.equal(ginCostPerBale(lint), 0);
  assert.equal(cleanCottonTerms({}), null);
});
check('gin for seed nets the seed value less the ginning, a bale', () => {
  assert.equal(netPerBale(forSeed), 39.25);
});
check('the cost of ginning bales: GST on the ginning only, not the levies', () => {
  assert.deepEqual(ginCostFor(forSeed, 100), { exGst: 7875, gst: 750, total: 8625 });
  assert.deepEqual(ginCostFor(lint, 100), { exGst: 0, gst: 0, total: 0 });
  assert.equal(ginCostFor({ cottonTerms: { ...terms, gstOnGin: false } }, 100).gst, 0);
});
check('a card says what the contract nets or costs', () => {
  assert.equal(kindSummary(lint), '');
  assert.ok(kindSummary(forSeed).includes('$39.25 a bale'));
  assert.ok(kindSummary(ginning).includes('$78.75'));
});
check('only open contracts with the gin are offered on a ginning run', () => {
  assert.deepEqual(ginContracts([lint, forSeed, { ...ginning, paid: true }]).map((s) => s.id), ['s1']);
});

console.log('\n=== position ===');
check('a contract with the gin is not lint sold', () => {
  const rows = salesByCommodity([{ id: 'cotton', name: 'Cotton' }], [lint, forSeed, ginning], []);
  assert.equal(rows[0].tons, 600);
  assert.equal(rows[0].contractCount, 1);
});
check('bales on a run to the contract count as delivered, and the seed is its value', () => {
  const run = { id: 'm1', tos: [{ type: 'sale', id: 's1', tons: 1348 }], froms: [] };
  const e = saleEconomics(forSeed, [run]);
  assert.equal(e.tonsDelivered, 1348);
  assert.equal(e.totalValue, 1350 * 118);
});

console.log('\n=== the confirmation ===');
check('gin for seed shows the seed value, the ginning charges and the net', () => {
  const rows = Object.fromEntries(termRows(forSeed, { unit: 'bale', name: 'Cotton' }));
  assert.ok(rows['Seed value'][0].includes('118.00 per bale'));
  assert.ok(rows.Ginning.some((l) => l.includes('Ginning $75.00 per bale, plus GST')));
  assert.ok(rows.Ginning.some((l) => l.includes('39.25 per bale')));
  assert.equal(rows.Price, undefined);
});
check('ginning only has no price, just the charges', () => {
  const rows = Object.fromEntries(termRows(ginning, { unit: 'bale', name: 'Cotton' }));
  assert.equal(rows.Price, undefined);
  assert.equal(rows['Seed value'], undefined);
  assert.equal(ginTermsLines(ginning).length, 3);
});
check('a lint sale reads as before', () => {
  const rows = Object.fromEntries(termRows(lint, { unit: 'bale', name: 'Cotton' }));
  assert.ok(rows.Price[0].includes('570.00 per bale'));
  assert.equal(rows.Ginning, undefined);
});

console.log('\n=== saved ===');
const FARM = '11111111-1111-1111-1111-111111111111';
const SID = '99999999-9999-4999-8999-999999999999';
const CID = '88888888-8888-4888-8888-888888888888';
const stateWith = (sales) => ({
  currentYear: '2026', nextMovementNo: 1, businessDetails: {},
  years: { 2026: { commodities: [{ id: CID, name: 'Cotton', unit: 'bale' }], fields: [], storages: [], movements: [], invoices: [], overheads: {}, sales, payables: [] } },
});
const sale = (extra) => ({ id: SID, commodityId: CID, tons: 1, price: 1, ...extra });
check('the kind and charges are not sent until chosen, sent when chosen, and going back to a lint sale reaches the server', () => {
  const plain = stateToRows(stateWith([sale({})]), FARM).sales[0];
  assert.ok(!('cotton_kind' in plain) && !('cotton_terms' in plain));
  const sent = stateToRows(stateWith([sale({ cottonKind: 'ginforseed', cottonTerms: terms })]), FARM);
  assert.equal(sent.sales[0].cotton_kind, 'ginforseed');
  assert.equal(sent.sales[0].cotton_terms.ginRate, 75);
  const back = stateToRows(stateWith([sale({ cottonKind: '', cottonTerms: null, __hasCottonKind: true, __hasCottonTerms: true })]), FARM).sales[0];
  assert.equal(back.cotton_kind, null);
  assert.equal(back.cotton_terms, null);
});
check('and it reads back as it was', () => {
  const rows = stateToRows(stateWith([sale({ cottonKind: 'ginning', cottonTerms: terms })]), FARM);
  const s = rowsToState(rows).years['2026'].sales[0];
  assert.equal(s.cottonKind, 'ginning');
  assert.deepEqual(s.cottonTerms, terms);
});

console.log('\n=== the screens ===');
check('the contract sheet has the type, the charges and the net, and saves them', () => {
  const v = src('views/sales.js');
  assert.ok(v.includes("id: 'cottonKind'") && v.includes("id: 'gtGin'") && v.includes('id="gin-net"'));
  assert.ok(v.includes("cottonKind: isBalesNow() && kindEl.value !== 'lint' ? kindEl.value : ''"));
});
check('a bale shed (a tally storage counting bales) is a place lint can go, so saving a run again keeps its lot there', () => {
  const v = src('views/ginrun.js');
  assert.ok(v.includes("const baleShed = (s) => s.kind === 'tally' && /bale/i.test(s.unitLabel || '')"));
  assert.ok(v.includes("(unit === 'bale' && baleShed(s))"));
});
check('a gin run picks its contract, fills the rates, and counts the bales there; lint cannot go to those contracts', () => {
  const v = src('views/ginrun.js');
  assert.ok(v.includes("id: 'g-contract'"));
  assert.ok(v.includes("tos.push({ type: 'sale', id: ginSale.id, tons: bales })"));
  assert.ok(v.includes('!isGinContract(s)'));
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
