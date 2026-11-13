// Run with:
//   node tests/silopick.test.mjs
//
// Which silos a movement offers once a commodity is chosen.
import assert from 'node:assert/strict';
import { pickableSilos } from '../docs/js/silopick.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

const wheatSilo = { id: 's1', name: 'Silo 1', commodityId: 'wheat', openingStock: 200 };
const barleySilo = { id: 's2', name: 'Silo 2', commodityId: 'barley', openingStock: 100 };
const emptySilo = { id: 's3', name: 'Silo 3', commodityId: null, openingStock: 0 };
const unnamedFull = { id: 's4', name: 'Silo 4', commodityId: null, openingStock: 150 };
const all = [wheatSilo, barleySilo, emptySilo, unnamedFull];
const names = (list) => list.map((s) => s.name);

console.log('\n=== taking grain out ===');

check('only silos that hold the commodity', () => {
  assert.deepEqual(names(pickableSilos(all, 'wheat')), ['Silo 1']);
});
check('an empty silo is not offered: there is nothing in it to take', () => {
  assert.ok(!names(pickableSilos(all, 'wheat')).includes('Silo 3'));
});
check('a silo with grain but no commodity set is not offered, as nothing says what it holds', () => {
  assert.ok(!names(pickableSilos(all, 'wheat')).includes('Silo 4'));
});

console.log('\n=== putting grain in ===');

check('a silo holding the commodity, or an empty one that could be filled', () => {
  assert.deepEqual(names(pickableSilos(all, 'wheat', { to: true })), ['Silo 1', 'Silo 3']);
});
check('a silo with another grain still in it is not offered', () => {
  assert.ok(!names(pickableSilos(all, 'wheat', { to: true })).includes('Silo 2'));
});
check('a silo labelled with another grain but now empty is offered, to take this one', () => {
  const emptiedBarley = { id: 's6', name: 'Silo 6', commodityId: 'barley', openingStock: 80 };
  const movements = [{ froms: [{ type: 'silo', id: 's6', tons: 80 }], tos: [] }];
  assert.ok(names(pickableSilos([emptiedBarley], 'wheat', { to: true, movements })).includes('Silo 6'));
  assert.ok(!names(pickableSilos([emptiedBarley], 'wheat', { movements })).includes('Silo 6'), 'but not to take grain out of');
});
check('a silo with no commodity but grain still in it is not offered', () => {
  assert.ok(!names(pickableSilos(all, 'wheat', { to: true })).includes('Silo 4'));
});
check('a silo that has been emptied by loads out counts as empty', () => {
  const drained = { id: 's5', name: 'Silo 5', commodityId: null, openingStock: 100 };
  const movements = [{ froms: [{ type: 'silo', id: 's5', tons: 100 }], tos: [] }];
  assert.ok(names(pickableSilos([drained], 'wheat', { to: true, movements })).includes('Silo 5'));
});

console.log('\n=== no commodity chosen, and tickets already saved ===');

check('with no commodity chosen every silo is offered', () => {
  assert.equal(pickableSilos(all, '').length, 4);
});
check('a silo already on the ticket stays on the list, so an old ticket does not lose it', () => {
  assert.ok(names(pickableSilos(all, 'wheat', { keep: ['s2'] })).includes('Silo 2'));
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
