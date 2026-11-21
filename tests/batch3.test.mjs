// Run with:
//   node tests/batch3.test.mjs
//
// Batch 3 of the review: money and rollover.
//   - a gin bill we pay is the ginning the cotton figures already take off, so it is not taken off again as an "other" bill
//   - a new season keeps how a commodity is counted and its cotton and hay settings, and a store's unit, site and outload end
//   - a table the server refuses this account is held and named, and the rest of the push carries on
//   - cotton's bales are not added to the farm's tonnes
//   - a carried contract takes its share of a flat ginning amount, not all of it
//   - last season's closing stock finds the shrink on loads with no commodity set
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../docs/js/version.js';

const stamp = APP_VERSION.split('.').pop();
const { payablesCost } = await import(`../docs/js/payables.js?v=${stamp}`);
const { positionRows, positionTotals, closingStock } = await import(`../docs/js/derived.js?v=${stamp}`);
const { setShrinkSource } = await import(`../docs/js/shrink.js?v=${stamp}`);
const { kindsForTable } = await import(`../docs/js/dirty.js?v=${stamp}`);
const { buildCarriedSale } = await import(`../docs/js/carryover.js?v=${stamp}`);
const { saleEconomics, invoiceTotals, levyFreightOf } = await import(`../docs/js/derived.js?v=${stamp}`);
const { stateToRows, rowsToState } = await import(`../docs/js/mapping.js?v=${stamp}`);
const { eofySnapshot } = await import(`../docs/js/eofy.js?v=${stamp}`);

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

console.log('\n=== ginning is taken off once ===');
const gin = { gin: { payableId: 'bill-1', lintKg: 90800, ginRate: 60 } };
const bill = { id: 'bill-1', kind: 'other', amount: 24000, gst: 2400, payer: null };
check('the bill made from a ginning run is not counted again as a cost', () => {
  assert.equal(payablesCost([], [gin], [bill]).other, 0);
  assert.equal(payablesCost([], [gin], [bill]).total, 0);
});
check('an ordinary "other" bill still comes off profit', () => {
  const rates = { id: 'bill-2', kind: 'other', amount: 500, gst: 50 };
  assert.equal(payablesCost([], [gin], [bill, rates]).other, 500);
});
check('with no run behind it, a bill is a cost as before', () => {
  assert.equal(payablesCost([], [], [bill]).other, 24000);
});

console.log('\n=== a table the server refuses ===');
check('a refused table names the entries that belong to it', () => {
  assert.deepEqual(kindsForTable('fields').sort(), ['field']);
  assert.deepEqual(kindsForTable('field_agronomy').sort(), ['field']);
  assert.deepEqual(kindsForTable('movement_legs'), ['movement']);
  assert.deepEqual(kindsForTable('input_stock'), ['inputmove']);
  assert.deepEqual(kindsForTable('nothing'), []);
});
check('the push holds a refused table for a non-owner, and carries on to the loads behind it', () => {
  const s = read('docs/js/sync.js');
  assert.ok(s.includes("role !== 'owner' && isDenial(error)"));
  assert.ok(/heldTables\.add\(table\);\s*break;/.test(s));
  assert.ok(s.includes('if (heldTables.has(table)) continue;'));
  assert.ok(s.includes('!stuck.has(q) && !held.has(q)'), 'held entries must stay owed');
  assert.ok(s.includes('if (stuck.size || held.size) return result;'), 'a push with held entries is not reported as clean');
});

console.log('\n=== a new season keeps the setup ===');
check('commodity unit, cotton and hay settings, and a store\'s unit, site and end are carried', () => {
  const st = read('docs/js/storage.js');
  const body = st.slice(st.indexOf('createYear(year) {'), st.indexOf('addPastSeason('));
  assert.ok(body.includes("unit: c.unit || 't'"));
  assert.ok(body.includes('hasCotton(c.cotton) ? { cotton: { ...c.cotton }, __hasCotton: true }'));
  assert.ok(body.includes('hasHay(c.hay) ? { hay: { ...c.hay }, __hasHay: true }'));
  assert.ok(body.includes("unitLabel: s.unitLabel || 't'"));
  assert.ok(body.includes('property: s.property, __hasProperty: true'));
  assert.ok(body.includes('outloadEnd: s.outloadEnd, __hasOutloadEnd: true'));
});

console.log('\n=== cotton in the farm tonnes ===');
const wheat = { id: 'w', name: 'Wheat', mtmPrice: 400 };
const cotton = { id: 'c', name: 'Cotton', unit: 'bale', mtmPrice: 500 };
const fields = [
  { id: 'fw', commodityId: 'w', areaHa: 100, yieldTHa: 4, yieldMode: 'estimate' },
  { id: 'fc', commodityId: 'c', areaHa: 100, yieldTHa: 10, yieldMode: 'estimate' },
];
check('cotton counts in the farm tonnes as the weight of its lint (227 kg a standard bale), not as bales added to tonnes', () => {
  const rows = positionRows([wheat, cotton], fields, [], []);
  const totals = positionTotals(rows);
  assert.ok(Math.abs(totals.productionTons - (400 + 227)) < 1e-9, 'wheat 400 t plus 1,000 bales of 227 kg');
  assert.ok(Math.abs(totals.unsoldTons - (400 + 227)) < 1e-9);
  assert.ok(totals.unsoldValue > 400 * 400, 'the cotton\'s value is still counted');
});
check('the end-of-year position counts cotton the same way', () => {
  const sales = [{ id: 's1', commodityId: 'c', tons: 100, price: 500, buyer: 'Merchant' }];
  const snap = eofySnapshot({ asAt: '2027-06-30', commodities: [wheat, cotton], fields, sales, movements: [], invoices: [] });
  assert.ok(Math.abs(snap.position.soldTons - 22.7) < 1e-6, '100 bales sold is 22.7 t');
  assert.ok(Math.abs(snap.position.unsoldTons - (400 + 204.3)) < 1e-6);
  assert.ok(Math.abs(snap.notDelivered.tons - 22.7) < 1e-6);
});

console.log('\n=== a carried contract ===');
check('a flat ginning amount is shared out by the tonnes carried', () => {
  const sale = { id: 's', commodityId: 'c', tons: 1000, price: 500, ginning: 9000, buyer: 'B' };
  const half = buildCarriedSale(sale, { commodityId: 'c2', tons: 400, prevLabel: '2025/26' });
  assert.equal(half.ginning, 3600);
  const all = buildCarriedSale(sale, { commodityId: 'c2', tons: 1000, prevLabel: '2025/26' });
  assert.equal(all.ginning, 9000);
});

console.log('\n=== last season\'s closing stock ===');
check('shrink on a load with no commodity is found from its own season\'s paddocks and silos', () => {
  // the farm in use is another season: its ids are different, so only the season's own records can place the load
  setShrinkSource(() => ({ commodities: [], fields: [], storages: [] }));
  const season = (shrinkPct) => ({
    commodities: [{ id: 'w', name: 'Wheat', mtmPrice: 400, shrinkPct }],
    fields: [{ id: 'f', commodityId: 'w', areaHa: 100, yieldTHa: 4, yieldMode: 'estimate' }],
    storages: [{ id: 's', kind: 'silo', commodityId: 'w' }],
    sales: [],
    movements: [{ id: 'm', froms: [{ type: 'field', id: 'f', tons: 100 }], tos: [{ type: 'silo', id: 's', tons: 100 }], tons: 100 }],
  });
  const without = closingStock(season(0), 'Wheat').tons;
  const withShrink = closingStock(season(1), 'Wheat').tons;
  assert.ok(Math.abs((without - withShrink) - 1) < 1e-9, `1% of 100 t should come off, got ${without - withShrink}`);
  // and the farm's own source is back afterwards
  assert.ok(read('docs/js/shrink.js').includes('finally { source = before; }'));
});

console.log('\n=== the storage list ===');
check('the lines under a storage name run the width of the card, so the spare line stays on one line on a phone', () => {
  const css = read('docs/css/styles.css');
  assert.ok(css.includes('.storage-row > div:first-child { display: contents; }'));
  assert.ok(css.includes('.storage-row > div:first-child > :not(.main) { grid-column: 1 / -1; min-width: 0; }'));
  assert.ok(css.includes('.storage-row > .sr-col { grid-row: 1; }'));
});

console.log('\n=== levies are on the farm-gate value ===');
const sold = (extra = {}) => ({ id: 's', tons: 100, price: 400, freight: 20, leviesPct: 0.01, ...extra });
check('the contract takes its freight off before levies, unless it says another figure', () => {
  assert.equal(levyFreightOf(sold()), 20);
  assert.equal(levyFreightOf(sold({ levyFreight: 50 })), 50);
  assert.equal(levyFreightOf(sold({ levyFreight: 0 })), 0, 'a typed zero is a figure, not blank');
  assert.equal(levyFreightOf(sold({ freight: 0 })), 0, 'sold ex farm there is nothing to take off');
  assert.ok(Math.abs(saleEconomics(sold()).levies - -3.8) < 1e-9);
  assert.ok(Math.abs(saleEconomics(sold({ levyFreight: 50 })).levies - -3.5) < 1e-9);
});
check('the invoice works levies out on the same value, and the typed figure moves it', () => {
  const lines = [{ tons: 100, subtotal: 40000, movementId: 'm' }];
  assert.ok(Math.abs(invoiceTotals(sold(), lines).levies - 380) < 1e-6);
  assert.ok(Math.abs(invoiceTotals(sold({ levyFreight: 50 }), lines).levies - 350) < 1e-6);
  assert.ok(Math.abs(invoiceTotals(sold({ freight: 0 }), lines).levies - 400) < 1e-6);
});
check('the levy freight is saved with the contract terms and comes back; blank sends nothing', () => {
  const FARM = '11111111-1111-4111-8111-111111111111';
  const mk = (sale) => ({ currentYear: '2026', years: { 2026: { __seasonId: '22222222-2222-4222-8222-222222222222', commodities: [], fields: [], storages: [], sales: [{ id: '33333333-3333-4333-8333-333333333333', commodityId: null, tons: 10, price: 100, ...sale }], movements: [], invoices: [], overheads: {}, payables: [], orders: [], freightOrders: [], inputStock: [], sprayJobs: [] } } });
  const terms = (sale) => stateToRows(mk(sale), FARM).sale_terms[0];
  assert.ok(!('levy_freight' in terms({})), 'a contract that never set it sends no column');
  assert.equal(terms({ levyFreight: 35 }).levy_freight, 35);
  assert.equal(terms({ levyFreight: undefined, __hasLevyFreight: true }).levy_freight, null, 'clearing it reaches the server');
  const back = rowsToState(stateToRows(mk({ levyFreight: 35 }), FARM)).years['2026'].sales[0];
  assert.equal(back.levyFreight, 35);
});
check('the contract form has the box, and the invoice says what its levies are on', () => {
  assert.ok(read('docs/js/views/sales.js').includes("id: 'levyFreight'"));
  assert.ok(read('docs/js/views/invoice.js').includes('to match their RCTI'));
  assert.ok(read('supabase/migrations/20261226000000_levy_freight.sql').includes('levy_freight numeric'));
});

console.log('\n=== cotton bales on the totals card ===');
check('the farm totals count the bales apart from the tonnes, and the card shows them', () => {
  const totals = positionTotals(positionRows([wheat, cotton], fields, [], []));
  assert.equal(totals.productionBales, 1000);
  assert.ok(read('docs/js/views/position.js').includes('and ${num(totals.productionBales, 0)} b</span>'), 'Total produced reads "7,068 t and 2,824 b"');
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
