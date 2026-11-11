#!/usr/bin/env node
//
// Finding a silo in a long list.
//
//   node tests/storagefilter.test.mjs
//
// The names are a real farm's: "13 Silo", "01 silo", "Kot 3", "02 silo (Lancer
// seed)". The thing to get right is that a number finds the silo with that
// number — typing 13 must not also show 113, 130 or silo 43.

import assert from 'node:assert';
import { searchStorages, commodityTabs, filterByTab, naturalByName, NO_COMMODITY, sortStorages, sortGroupLabel, SORTS } from '../docs/js/storagefilter.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

const COMMODITIES = [{ id: 'w', name: 'Wheat' }, { id: 'b', name: 'Barley' }, { id: 'f', name: 'Faba Beans' }];
const mk = (name, commodityId, extra = {}) => ({ id: name, name, commodityId, ...extra });
const STORAGES = [
  mk('01 silo', 'f', { cropYear: '25/26' }), mk('02 silo (Lancer seed)', 'w'), mk('03 Silo', null), mk('13 Silo', 'f', { cropYear: '25/26' }),
  mk('113 Silo', 'b'), mk('130 Silo', 'b'), mk('23 Silo', 'w'), mk('43 Silo', 'f', { grade: 'FAB1' }),
  mk('Kot 1', 'b', { cropYear: '25/26' }), mk('Kot 3', 'w', { cropYear: '25/26' }), mk('Kot 13', 'w'), mk('A06 Silo', 'w'),
];
const names = (list) => list.map((s) => s.name);

console.log('\n=== searching ===');

check('nothing typed shows everything', () => {
  assert.equal(searchStorages(STORAGES, COMMODITIES, '').length, STORAGES.length);
  assert.equal(searchStorages(STORAGES, COMMODITIES, '   ').length, STORAGES.length);
});
check('"13" finds silo 13 and Kot 13 — not 113, 130, or 43', () => {
  assert.deepEqual(names(searchStorages(STORAGES, COMMODITIES, '13')), ['13 Silo', 'Kot 13']);
});
check('"3" finds silo 03 and Kot 3 — not 13, 23 or 43', () => {
  assert.deepEqual(names(searchStorages(STORAGES, COMMODITIES, '3')), ['03 Silo', 'Kot 3']);
});
check('leading zeros do not matter, either way round', () => {
  assert.deepEqual(names(searchStorages(STORAGES, COMMODITIES, '01')), ['01 silo', 'Kot 1']);
  assert.deepEqual(names(searchStorages(STORAGES, COMMODITIES, '1')), ['01 silo', 'Kot 1']);
  assert.deepEqual(names(searchStorages(STORAGES, COMMODITIES, '003')), ['03 Silo', 'Kot 3']);
});
check('a number nobody has falls back to the text appearing in a name', () => {
  assert.deepEqual(names(searchStorages(STORAGES, COMMODITIES, '11')), ['113 Silo'], '11 is in 113, and no silo is numbered 11');
});
check('a name, in any case', () => {
  assert.deepEqual(names(searchStorages(STORAGES, COMMODITIES, 'kot')), ['Kot 1', 'Kot 3', 'Kot 13']);
  assert.deepEqual(names(searchStorages(STORAGES, COMMODITIES, 'LANCER')), ['02 silo (Lancer seed)']);
});
check('a commodity', () => {
  assert.deepEqual(names(searchStorages(STORAGES, COMMODITIES, 'faba')), ['01 silo', '13 Silo', '43 Silo']);
});
check('a grade, or a crop year', () => {
  assert.deepEqual(names(searchStorages(STORAGES, COMMODITIES, 'fab1')), ['43 Silo']);
  assert.deepEqual(names(searchStorages(STORAGES, COMMODITIES, '25/26')), ['01 silo', '13 Silo', 'Kot 1', 'Kot 3']);
});
check('every word has to match, so words narrow the list', () => {
  assert.deepEqual(names(searchStorages(STORAGES, COMMODITIES, 'wheat 25/26')), ['Kot 3']);
  assert.deepEqual(names(searchStorages(STORAGES, COMMODITIES, 'barley kot')), ['Kot 1']);
});
check('a search with no match returns nothing, not everything', () => {
  assert.deepEqual(searchStorages(STORAGES, COMMODITIES, 'zzz'), []);
  assert.deepEqual(searchStorages(STORAGES, COMMODITIES, '999'), []);
});
check('a silo with no commodity does not break the search', () => {
  assert.deepEqual(names(searchStorages(STORAGES, COMMODITIES, '03')), ['03 Silo', 'Kot 3'], 'the silo with no commodity is found, along with Kot 3');
});

console.log('\n=== commodity tabs ===');

check('one tab per commodity that has silos, with how many', () => {
  const tabs = commodityTabs(STORAGES, COMMODITIES);
  assert.deepEqual(tabs.map((t) => [t.name, t.count]), [['Wheat', 5], ['Barley', 3], ['Faba Beans', 3], ['No commodity', 1]]);
});
check('a commodity with no silos has no tab', () => {
  const tabs = commodityTabs(STORAGES.filter((s) => s.commodityId !== 'b'), COMMODITIES);
  assert.ok(!tabs.some((t) => t.name === 'Barley'));
});
check('no tab for "no commodity" when every silo has one', () => {
  assert.ok(!commodityTabs(STORAGES.filter((s) => s.commodityId), COMMODITIES).some((t) => t.id === NO_COMMODITY));
});
check('choosing a tab shows only that commodity\'s silos', () => {
  assert.deepEqual(names(filterByTab(STORAGES, COMMODITIES, 'f')), ['01 silo', '13 Silo', '43 Silo']);
  assert.deepEqual(names(filterByTab(STORAGES, COMMODITIES, NO_COMMODITY)), ['03 Silo']);
});
check('no tab chosen means all of them', () => {
  assert.equal(filterByTab(STORAGES, COMMODITIES, '').length, STORAGES.length);
});
check('the tabs follow a search: they count what was found, not everything', () => {
  const found = searchStorages(STORAGES, COMMODITIES, '25/26');
  assert.deepEqual(commodityTabs(found, COMMODITIES).map((t) => [t.name, t.count]), [['Wheat', 1], ['Barley', 1], ['Faba Beans', 2]]);
});

console.log('\n=== order ===');

check('silos sort by number, not by the first digit', () => {
  const sorted = [mk('13 Silo'), mk('2 silo'), mk('Kot 10'), mk('Kot 2'), mk('01 silo')].sort(naturalByName);
  assert.deepEqual(names(sorted), ['01 silo', '2 silo', '13 Silo', 'Kot 2', 'Kot 10']);
});

console.log('\n=== sorting ===');

const GRADED = [
  mk('Kot 3', 'w', { grade: 'APH1', cropYear: '25/26', createdAt: 5 }),
  mk('13 Silo', 'f', { grade: 'FAB1', cropYear: '25/26', createdAt: 9 }),
  mk('02 silo', 'w', { grade: 'AUH2', cropYear: '26/27', createdAt: 1 }),
  mk('03 Silo', null, { createdAt: 7 }),
  mk('01 silo', 'w', { grade: 'APH1', cropYear: '26/27', createdAt: 3 }),
  mk('20 Silo', 'b', { grade: 'BAR1', createdAt: 2 }),
  mk('04 Silo', null, { createdAt: 8 }),
];

check('by grade: graded silos first, in grade order, ungraded last', () => {
  assert.deepEqual(names(sortStorages(GRADED, 'grade')), ['01 silo', 'Kot 3', '02 silo', '20 Silo', '13 Silo', '03 Silo', '04 Silo']);
});
check('within one grade the silos run in number order', () => {
  const aph1 = sortStorages(GRADED, 'grade').filter((s) => s.grade === 'APH1');
  assert.deepEqual(names(aph1), ['01 silo', 'Kot 3']);
});
check('by crop year: the newest season first, silos with no crop year last', () => {
  assert.deepEqual(names(sortStorages(GRADED, 'crop')), ['01 silo', '02 silo', '13 Silo', 'Kot 3', '03 Silo', '04 Silo', '20 Silo']);
});
check('by name: in number order, so 2 comes before 13', () => {
  assert.deepEqual(names(sortStorages(GRADED, 'name')), ['01 silo', '02 silo', '03 Silo', '04 Silo', '13 Silo', '20 Silo', 'Kot 3']);
});
check('newest added first is the order the list always had', () => {
  assert.deepEqual(names(sortStorages(GRADED, 'newest')), ['13 Silo', '04 Silo', '03 Silo', 'Kot 3', '01 silo', '20 Silo', '02 silo']);
  assert.deepEqual(names(sortStorages(GRADED)), names(sortStorages(GRADED, 'newest')), 'and it is the default');
});
check('sorting leaves the list it was given alone', () => {
  const before = names(GRADED);
  sortStorages(GRADED, 'grade');
  assert.deepEqual(names(GRADED), before);
});
check('grades sort as text with numbers in order, whatever the case', () => {
  const g = [mk('a', null, { grade: 'h2' }), mk('b', null, { grade: 'H10' }), mk('c', null, { grade: 'H1' })];
  assert.deepEqual(names(sortStorages(g, 'grade')), ['c', 'a', 'b']);
});
check('the heading a silo sits under, for the sorts that have headings', () => {
  assert.equal(sortGroupLabel(GRADED[0], 'grade'), 'APH1');
  assert.equal(sortGroupLabel(GRADED[3], 'grade'), 'No grade');
  assert.equal(sortGroupLabel(GRADED[0], 'crop'), '25/26');
  assert.equal(sortGroupLabel(GRADED[3], 'crop'), 'No crop year');
  assert.equal(sortGroupLabel(GRADED[0], 'name'), null);
  assert.equal(sortGroupLabel(GRADED[0], 'newest'), null);
});
check('a sort the screen offers is one the sorter knows', () => {
  for (const s of SORTS) assert.equal(sortStorages(GRADED, s.id).length, GRADED.length, s.id);
});

console.log('');
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('ALL PASS');
