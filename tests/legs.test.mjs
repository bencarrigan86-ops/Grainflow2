// Run with:
//   node tests/legs.test.mjs
//
// A load's legs keep one id for good, and copies that piled up are taken out.
import assert from 'node:assert/strict';
import { settleLegs, dedupeLegs } from '../docs/js/legs.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

let n = 0;
const makeId = () => `new-${++n}`;
const leg = (type, id, tons, __legId) => ({ type, id, tons, ...(__legId ? { __legId } : {}) });

console.log('\n=== legs keep their id ===');

check('new legs are given ids', () => {
  const { legs, retired } = settleLegs([], [leg('field', 'f1', 30), leg('silo', 's1', 30)], makeId);
  assert.ok(legs.every((l) => l.__legId));
  assert.equal(new Set(legs.map((l) => l.__legId)).size, 2);
  assert.deepEqual(retired, []);
});
check('settling twice gives the same ids both times — nothing new is minted on a second push', () => {
  const first = settleLegs([], [leg('field', 'f1', 30)], makeId).legs;
  const second = settleLegs(first, first, makeId).legs;
  assert.equal(second[0].__legId, first[0].__legId);
});
check('an edited load keeps the id of a leg that is still there, even with new tonnes', () => {
  const before = settleLegs([], [leg('field', 'f1', 30), leg('silo', 's1', 30)], makeId).legs;
  const { legs, retired } = settleLegs(before, [leg('field', 'f1', 28), leg('silo', 's1', 28)], makeId);
  assert.equal(legs[0].__legId, before[0].__legId);
  assert.equal(legs[1].__legId, before[1].__legId);
  assert.deepEqual(retired, []);
});
check('a leg taken out is retired, not forgotten on the server', () => {
  const before = settleLegs([], [leg('field', 'f1', 30), leg('silo', 's1', 20), leg('silo', 's2', 10)], makeId).legs;
  const { legs, retired } = settleLegs(before, [leg('field', 'f1', 30), leg('silo', 's1', 30)], makeId);
  assert.equal(legs.length, 2);
  assert.deepEqual(retired, [before[2].__legId]);
});

console.log('\n=== copies are taken out ===');

const doubled = {
  tons: 30,
  froms: [leg('field', 'a5', 30, 'x1'), leg('field', 'a5', 30, 'x2')],
  tos: [leg('silo', 'a10', 30, 'y1'), leg('silo', 'a10', 30, 'y2')],
};
check('a load shown twice over goes back to one of each, and the extras are retired', () => {
  const r = dedupeLegs(doubled);
  assert.equal(r.froms.length, 1);
  assert.equal(r.tos.length, 1);
  assert.deepEqual(r.retired.sort(), ['x2', 'y2']);
  assert.equal(r.changed, true);
});
check('three copies go back to one', () => {
  const r = dedupeLegs({ tons: 30, froms: [leg('field', 'a', 30, '1'), leg('field', 'a', 30, '2'), leg('field', 'a', 30, '3')], tos: [leg('silo', 's', 30, '4')] });
  assert.equal(r.froms.length, 1);
  assert.deepEqual(r.retired.sort(), ['2', '3']);
});
check('a load of two equal parts from one place is left alone — it adds up to its own weight', () => {
  const m = { tons: 30, froms: [leg('field', 'a', 15, '1'), leg('field', 'a', 15, '2')], tos: [leg('silo', 's', 30, '3')] };
  const r = dedupeLegs(m);
  assert.equal(r.changed, false);
  assert.equal(r.froms.length, 2);
  assert.deepEqual(r.retired, []);
});
check('a blend from two different places is left alone', () => {
  const m = { tons: 30, froms: [leg('field', 'a', 18, '1'), leg('field', 'b', 12, '2')], tos: [leg('silo', 's', 30, '3')] };
  assert.equal(dedupeLegs(m).changed, false);
});
check('a load with no weight is not touched', () => {
  assert.equal(dedupeLegs({ tons: 0, froms: [leg('field', 'a', 5), leg('field', 'a', 5)], tos: [] }).changed, false);
});
check('copies that do not bring it back to the weight are not guessed at', () => {
  const m = { tons: 30, froms: [leg('field', 'a', 20, '1'), leg('field', 'a', 20, '2'), leg('field', 'b', 20, '3')], tos: [] };
  assert.equal(dedupeLegs(m).changed, false);
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
