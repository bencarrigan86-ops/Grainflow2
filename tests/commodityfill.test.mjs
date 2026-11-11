// Run with:
//   node tests/commodityfill.test.mjs
import assert from 'node:assert/strict';
import { commodityFills } from '../docs/js/commodityfill.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

const load = (silo, commodityId, from) => ({ commodityId, froms: [{ type: 'field', id: from || 'f1' }], tos: [{ type: 'silo', id: silo }] });

check('a silo with no commodity takes the one its loads agree on', () => {
  const r = commodityFills([{ id: 's1', name: '03 Silo' }], [load('s1', 'wheat'), load('s1', 'wheat')]);
  assert.equal(r.fills.length, 1);
  assert.equal(r.fills[0].commodityId, 'wheat');
  assert.equal(r.fills[0].loads, 2);
});
check('a silo that already has a commodity is left alone', () => {
  const r = commodityFills([{ id: 's1', commodityId: 'barley' }], [load('s1', 'wheat')]);
  assert.equal(r.fills.length, 0);
  assert.equal(r.mixed.length, 0);
});
check('a silo that took two commodities is reported as mixed, not guessed', () => {
  const r = commodityFills([{ id: 's1' }], [load('s1', 'wheat'), load('s1', 'barley')]);
  assert.equal(r.fills.length, 0);
  assert.deepEqual(r.mixed[0].commodityIds.sort(), ['barley', 'wheat']);
});
check('a load with no commodity of its own is read from its paddock', () => {
  const r = commodityFills([{ id: 's1' }], [load('s1', undefined, 'f9')], [{ id: 'f9', commodityId: 'chick' }]);
  assert.equal(r.fills[0].commodityId, 'chick');
});
check('a silo with no loads, or loads of no known commodity, is left blank', () => {
  const r = commodityFills([{ id: 's1' }, { id: 's2' }], [load('s2', undefined)]);
  assert.equal(r.fills.length, 0);
  assert.equal(r.mixed.length, 0);
});
check('loads going out of a silo, or to a contract, do not count', () => {
  const r = commodityFills([{ id: 's1' }], [{ commodityId: 'wheat', froms: [{ type: 'silo', id: 's1' }], tos: [{ type: 'sale', id: 'x' }] }]);
  assert.equal(r.fills.length, 0);
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
