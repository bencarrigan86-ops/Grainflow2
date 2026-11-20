// Run with:
//   node tests/shrink.test.mjs
//
// Shrink in silos: a set percentage per commodity comes off grain going from a paddock into a silo. The silo's tracked stock
// and the commodity's unsold on Position both take it; nothing else (silo to silo, silo to contract, opening stock) shrinks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../docs/js/version.js';
const stamp = APP_VERSION.split('.').pop();
const { setShrinkSource, shrinkFraction, shrinkOnLoad, shrinkInSilo, shrinkForCommodity } = await import(`../docs/js/shrink.js?v=${stamp}`);
const { movementNetForStorage, storageLedgerStock, position, positionAtYield } = await import(`../docs/js/derived.js?v=${stamp}`);

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} ${a} vs ${b}`);

const wheat = { id: 'w', name: 'Wheat', shrinkPct: 0.7, mtmPrice: 300, openingStock: 0, retainedSeed: 0 };
setShrinkSource(() => [wheat]);
const intoSilo = { id: 'a', commodityId: 'w', tons: 100, froms: [{ type: 'field', id: 'f1', tons: 100 }], tos: [{ type: 'silo', id: 's1', tons: 100 }] };
const siloToSilo = { id: 'b', commodityId: 'w', tons: 50, froms: [{ type: 'silo', id: 's1', tons: 50 }], tos: [{ type: 'silo', id: 's2', tons: 50 }] };
const siloToSale = { id: 'c', commodityId: 'w', tons: 30, froms: [{ type: 'silo', id: 's2', tons: 30 }], tos: [{ type: 'sale', id: 'x', tons: 30 }] };
const fieldToSale = { id: 'd', commodityId: 'w', tons: 40, froms: [{ type: 'field', id: 'f1', tons: 40 }], tos: [{ type: 'sale', id: 'x', tons: 40 }] };

console.log('\n=== the percentage ===');
check('0.7 is 0.7 percent; nothing, zero or rubbish is none', () => {
  close(shrinkFraction(wheat), 0.007);
  assert.equal(shrinkFraction({}), 0); assert.equal(shrinkFraction({ shrinkPct: 0 }), 0); assert.equal(shrinkFraction({ shrinkPct: 'x' }), 0); assert.equal(shrinkFraction({ shrinkPct: -1 }), 0);
});

console.log('\n=== which loads shrink ===');
check('only a load from paddocks into a silo shrinks', () => {
  close(shrinkOnLoad(intoSilo), 0.7);
  assert.equal(shrinkOnLoad(siloToSilo), 0);
  assert.equal(shrinkOnLoad(siloToSale), 0);
  assert.equal(shrinkOnLoad(fieldToSale), 0, 'a paddock straight to a contract never sat in a silo');
});
check('a commodity with no shrink set is untouched', () => {
  setShrinkSource(() => [{ ...wheat, shrinkPct: 0 }]);
  assert.equal(shrinkOnLoad(intoSilo), 0);
  setShrinkSource(() => [wheat]);
});

console.log('\n=== the silo ===');
check('tracked stock is what went in less the shrink, less what went out', () => {
  const moves = [intoSilo, siloToSilo];
  close(movementNetForStorage('s1', moves), 100 - 0.7 - 50);
  close(movementNetForStorage('s2', moves), 50, 'a silo-to-silo move does not shrink again');
  close(storageLedgerStock({ id: 's1', openingStock: 20 }, moves), 20 + 100 - 0.7 - 50, 'opening stock is not shrunk');
  close(shrinkInSilo('s1', moves), 0.7);
});

console.log('\n=== Position ===');
check('unsold takes the shrink off, and the shrink is its own figure', () => {
  const fields = [{ id: 'f1', commodityId: 'w', areaHa: 100, yieldTHa: 3, yieldMode: 'estimate' }];
  const withShrink = position([wheat], fields, [], [intoSilo])[0];
  const without = position([{ ...wheat, shrinkPct: 0 }], fields, [], [intoSilo])[0];
  close(withShrink.shrinkTons, 0.7);
  close(without.unsoldTons - withShrink.unsoldTons, 0.7);
  assert.equal(withShrink.productionTons, without.productionTons, 'production is not changed');
  close(shrinkForCommodity(wheat, [intoSilo, siloToSilo]), 0.7);
});
check('the what-if yield scales the shrink with the crop', () => {
  const row = { opening: 0, productionTons: 1000, soldTons: 0, retainedSeed: 0, usedTons: 0, shrinkTons: 7, mtmPrice: 300, soldValue: 0, grossMarginCost: 0, commodity: wheat };
  const [r] = positionAtYield([row], 10);
  close(r.unsoldTons, 1100 - 7.7);
});

console.log('\n=== loads with no commodity, other stores, the layers ===');
const { layersForStorage } = await import(`../docs/js/outload.js?v=${stamp}`);
const farm = { commodities: [wheat], fields: [{ id: 'f1', commodityId: 'w' }], storages: [{ id: 's1', kind: 'silo', commodityId: 'w' }, { id: 'off', kind: 'silo', offFarm: {}, commodityId: 'w' }, { id: 'bales', kind: 'tally', unitLabel: 'bales', commodityId: 'w' }] };
check('a load with the Commodity box left blank takes its paddock commodity, or the silo one', () => {
  setShrinkSource(() => farm);
  const blank = { id: 'z', froms: [{ type: 'field', id: 'f1', tons: 100 }], tos: [{ type: 'silo', id: 's1', tons: 100 }] };
  close(shrinkOnLoad(blank), 0.7);
  const noField = { id: 'y', froms: [{ type: 'field', id: 'unknown', tons: 100 }], tos: [{ type: 'silo', id: 's1', tons: 100 }] };
  close(shrinkOnLoad(noField), 0.7, 'the silo says wheat');
});
check('a third party store and a bale store are not shrunk', () => {
  const toOff = { id: 'o', commodityId: 'w', froms: [{ type: 'field', id: 'f1', tons: 100 }], tos: [{ type: 'silo', id: 'off', tons: 100 }] };
  const toBales = { id: 'b', commodityId: 'w', froms: [{ type: 'field', id: 'f1', tons: 100 }], tos: [{ type: 'silo', id: 'bales', tons: 100 }] };
  assert.equal(shrinkOnLoad(toOff), 0); assert.equal(shrinkOnLoad(toBales), 0);
});
check('the silo layers add up to the tracked stock', () => {
  setShrinkSource(() => farm);
  const moves = [{ id: 'a', date: '2026-11-01', froms: [{ type: 'field', id: 'f1', tons: 100 }], tos: [{ type: 'silo', id: 's1', tons: 100 }] }];
  const layers = layersForStorage({ id: 's1', openingStock: 0 }, moves).layers;
  close(layers.reduce((a, l) => a + l.tons, 0), storageLedgerStock({ id: 's1', openingStock: 0 }, moves));
  setShrinkSource(() => [wheat]);
});
check('more than 25 percent is taken as 25', () => { close(shrinkFraction({ shrinkPct: 70 }), 0.25); });

console.log('\n=== on the screens ===');
check('the commodity sheet, the sync, the migration and the displays are all there', () => {
  assert.ok(read('docs/js/views/settings.js').includes("id: 'shrinkPct'") && read('docs/js/views/settings.js').includes("getNum(root, 'shrinkPct')"));
  assert.ok(read('docs/js/mapping.js').includes('shrink_pct'));
  assert.ok(read('docs/js/storage.js').includes('setShrinkSource('));
  assert.ok(/createYear\([\s\S]*?shrinkPct: c\.shrinkPct, __hasShrink: true/.test(read('docs/js/storage.js')), 'a new season keeps the shrink');
  assert.ok(read('supabase/migrations/20261224000000_commodity_shrink.sql').includes('shrink_pct numeric'));
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('commodities add column if not exists shrink_pct'));
  assert.ok(read('docs/js/views/position.js').includes('Shrink in silos'));
  assert.ok(read('docs/js/views/storage.js').includes('Shrink so far'));
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
