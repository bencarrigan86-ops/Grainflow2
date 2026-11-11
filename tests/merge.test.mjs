#!/usr/bin/env node
//
// Combining two paddocks.
//
//   node tests/merge.test.mjs
//
// What this protects: merging must not lose a load. Every load that came out of
// either paddock has to end up against the combined one, with its tonnes, and
// the paddock's total has to be exactly what the two had between them.

import assert from 'node:assert';
import { mergeFieldRecords, repointLoads, describeMerge } from '../docs/js/merge.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

const w3 = { id: 'w3', name: 'W3', areaHa: 60, yieldTHa: 3, commodityId: 'barley', yieldMode: 'estimate', ureaRequiredKgHa: 120, seedVariety: 'Planet', soilTestNKgHa: 40, ureaApplications: [{ date: '2026-06-10', rateKgHa: 100 }], notes: 'boggy corner' };
const w4 = { id: 'w4', name: 'W4', areaHa: 40, yieldTHa: 4, commodityId: 'barley', yieldMode: 'estimate', ureaRequiredKgHa: 150, seedVariety: 'Planet', soilTestNKgHa: 50, ureaApplications: [{ date: '2026-05-20', rateKgHa: 80 }], notes: '' };

console.log('\n=== the combined paddock ===');

check('the area is the sum and the name is the one chosen', () => {
  const m = mergeFieldRecords(w3, w4, 'W3/4');
  assert.equal(m.name, 'W3/4');
  assert.equal(m.areaHa, 100);
  assert.equal(m.id, 'w3', 'it is the kept paddock, updated, so its history is kept');
});
check('the yield estimate is weighted by area, so the two produce what they would have apart', () => {
  const m = mergeFieldRecords(w3, w4, 'W3/4');
  assert.equal(m.yieldTHa, 3.4, '(60 x 3 + 40 x 4) / 100');
  assert.equal(m.areaHa * m.yieldTHa, 60 * 3 + 40 * 4);
});
check('urea applications from both paddocks are kept, in date order', () => {
  const m = mergeFieldRecords(w3, w4, 'W3/4');
  assert.deepEqual(m.ureaApplications.map((a) => a.date), ['2026-05-20', '2026-06-10']);
});
check('everything else is the kept paddock\'s own', () => {
  const m = mergeFieldRecords(w3, w4, 'W3/4');
  assert.equal(m.ureaRequiredKgHa, 120);
  assert.equal(m.soilTestNKgHa, 40);
  assert.equal(m.commodityId, 'barley');
});
check('notes are joined, and a blank note adds nothing', () => {
  assert.equal(mergeFieldRecords(w3, w4, 'x').notes, 'boggy corner');
  assert.equal(mergeFieldRecords(w3, { ...w4, notes: 'steep' }, 'x').notes, 'boggy corner · steep');
});
check('a blank name keeps the old one rather than naming the paddock nothing', () => {
  assert.equal(mergeFieldRecords(w3, w4, '  ').name, 'W3');
});
check('merging does not alter the records it was given', () => {
  const before = JSON.stringify([w3, w4]);
  mergeFieldRecords(w3, w4, 'W3/4');
  assert.equal(JSON.stringify([w3, w4]), before);
});
check('two paddocks with no area still merge', () => {
  const m = mergeFieldRecords({ ...w3, areaHa: 0, yieldTHa: 2 }, { ...w4, areaHa: 0 }, 'W3/4');
  assert.equal(m.areaHa, 0);
  assert.equal(m.yieldTHa, 2);
});

console.log('\n=== the loads ===');

const loads = [
  { id: 'm1', froms: [{ type: 'field', id: 'w3', tons: 30, __legId: 'l1' }], tos: [{ type: 'silo', id: 's1', tons: 30 }] },
  { id: 'm2', froms: [{ type: 'field', id: 'w4', tons: 40, __legId: 'l2' }], tos: [{ type: 'silo', id: 's1', tons: 40 }] },
  { id: 'm3', froms: [{ type: 'field', id: 'a7', tons: 10, __legId: 'l3' }], tos: [{ type: 'silo', id: 's2', tons: 10 }] },
  { id: 'm4', froms: [{ type: 'silo', id: 'w4', tons: 5 }], tos: [{ type: 'silo', id: 's2', tons: 5 }] },   // a silo that happens to share the id
];

check('loads from the removed paddock now say they came from the kept one, tonnes and leg ids intact', () => {
  const { movements, changed } = repointLoads(loads, 'w4', 'w3');
  assert.deepEqual(changed, ['m2']);
  assert.deepEqual(movements.find((m) => m.id === 'm2').froms, [{ type: 'field', id: 'w3', tons: 40, __legId: 'l2' }]);
});
check('loads from other paddocks, and from a silo with the same id, are untouched', () => {
  const { movements } = repointLoads(loads, 'w4', 'w3');
  assert.equal(movements.find((m) => m.id === 'm3'), loads[2]);
  assert.equal(movements.find((m) => m.id === 'm4'), loads[3]);
});
check('the total carted from the combined paddock is what came from the two', () => {
  const { movements } = repointLoads(loads, 'w4', 'w3');
  const fromW3 = movements.flatMap((m) => m.froms).filter((l) => l.type === 'field' && l.id === 'w3').reduce((a, l) => a + l.tons, 0);
  assert.equal(fromW3, 30 + 40);
});

console.log('\n=== what the person is told first ===');

check('the confirmation counts the loads that will move and the area that results', () => {
  const d = describeMerge(w3, w4, loads, 'W3/4');
  assert.equal(d.loadsMoved, 1);
  assert.equal(d.areaHa, 100);
  assert.equal(d.droppedName, 'W4');
});
check('rates that will not carry across are named', () => {
  const d = describeMerge(w3, w4, loads, 'W3/4');
  assert.ok(d.losing.includes('urea required'));
  assert.ok(d.losing.includes('soil test N'));
  assert.ok(!d.losing.includes('seed variety'), 'the same variety is not a loss');
});

console.log('');
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('ALL PASS');
