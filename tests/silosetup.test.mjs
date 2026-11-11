#!/usr/bin/env node
//
// Setting the silos up for a new season.
//
//   node tests/silosetup.test.mjs
//
// The list is taken the way it was written, and the names are the ones from a
// real farm: "Kot03" in the list against "Kot 3" in the app, "43" against
// "43 Silo", "01" against "01 silo". What these protect:
//
//   a silo named in the list must carry over, not be cleared by accident;
//   a silo NOT in the list must be cleared — and nothing else touched;
//   a name that matches nothing must be reported, because the silo it meant
//   would otherwise be cleared and its grain forgotten.

import assert from 'node:assert';
import { parseCarryOver, patchFor, decisionsFromList, summarise, patchesFor } from '../docs/js/silosetup.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

const COMMODITIES = [
  { id: 'c-wheat', name: 'Wheat' }, { id: 'c-barley', name: 'Barley' }, { id: 'c-faba', name: 'Faba Beans' }, { id: 'c-canola', name: 'Canola' },
];
const names = ['01 silo', '02 silo (Lancer seed)', '03 Silo', '13 Silo', '42 Silo', '43 Silo', '44 Silo', '45 Silo', 'A06 Silo', 'Kot 1', 'Kot 2', 'Kot 3', 'Kot 4', 'Kot 5'];
const STORAGES = names.map((name, i) => ({ id: `s${i}`, name, kind: name.startsWith('Kot') ? 'silo' : 'silo', openingStock: 100 + i, currentHeight: 3, commodityId: 'c-canola', cropYear: '', grade: 'OLD', moisturePct: 12 }));
const idOf = (name) => STORAGES.find((s) => s.name === name).id;

// What was actually written, word for word.
const TEXT = `Wheat, Kot03, Kot04, Kot05
Barley Kot01
Faba Beans: 43, 42, 13, 44, 01, 45`;

console.log('\n=== reading the list ===');

check('the list as it was written finds every silo it names, under the right commodity', () => {
  const { entries, unmatched, unknownLines } = parseCarryOver(TEXT, COMMODITIES, STORAGES);
  assert.deepEqual(unmatched, []);
  assert.deepEqual(unknownLines, []);
  const by = Object.fromEntries(entries.map((e) => [e.storageId, e.commodityId]));
  assert.deepEqual(by, {
    [idOf('Kot 3')]: 'c-wheat', [idOf('Kot 4')]: 'c-wheat', [idOf('Kot 5')]: 'c-wheat',
    [idOf('Kot 1')]: 'c-barley',
    [idOf('43 Silo')]: 'c-faba', [idOf('42 Silo')]: 'c-faba', [idOf('13 Silo')]: 'c-faba',
    [idOf('44 Silo')]: 'c-faba', [idOf('01 silo')]: 'c-faba', [idOf('45 Silo')]: 'c-faba',
  });
});
check('ten silos named, ten found', () => {
  assert.equal(parseCarryOver(TEXT, COMMODITIES, STORAGES).entries.length, 10);
});
check('"Kot03" is Kot 3 and "01" is the 01 silo, not Kot 1', () => {
  const { entries } = parseCarryOver('Wheat: Kot03, 01', COMMODITIES, STORAGES);
  assert.deepEqual(entries.map((e) => e.storageId), [idOf('Kot 3'), idOf('01 silo')]);
});
check('"Faba Beans" is read as one commodity, not as "Faba" with a stray word', () => {
  const { entries, unknownLines } = parseCarryOver('Faba Beans: 43', COMMODITIES, STORAGES);
  assert.equal(unknownLines.length, 0);
  assert.equal(entries[0].commodityId, 'c-faba');
});
check('a colon, a comma or just a space after the commodity all work', () => {
  for (const line of ['Wheat: Kot03', 'Wheat, Kot03', 'Wheat Kot03', 'wheat - Kot03']) {
    assert.equal(parseCarryOver(line, COMMODITIES, STORAGES).entries[0]?.storageId, idOf('Kot 3'), line);
  }
});
check('silos separated by "and", semicolons or only spaces are still found', () => {
  assert.equal(parseCarryOver('Wheat: Kot03 and Kot04', COMMODITIES, STORAGES).entries.length, 2);
  assert.equal(parseCarryOver('Wheat: Kot03; Kot04', COMMODITIES, STORAGES).entries.length, 2);
  assert.equal(parseCarryOver('Wheat Kot03 Kot04', COMMODITIES, STORAGES).entries.length, 2);
});
check('a name that matches no silo is reported, not guessed at', () => {
  const { entries, unmatched } = parseCarryOver('Wheat: Kot03, Kot09, 99', COMMODITIES, STORAGES);
  assert.equal(entries.length, 1);
  assert.deepEqual(unmatched, ['Kot09', '99']);
});
check('a line that does not start with a commodity is reported', () => {
  const { unknownLines } = parseCarryOver('Sorghum: Kot03', COMMODITIES, STORAGES);
  assert.deepEqual(unknownLines, ['Sorghum: Kot03']);
});
check('blank lines and nothing at all are fine', () => {
  assert.deepEqual(parseCarryOver('\n\n', COMMODITIES, STORAGES).entries, []);
  assert.deepEqual(parseCarryOver(undefined, COMMODITIES, STORAGES).entries, []);
});

console.log('\n=== what happens to each silo ===');

const { entries } = parseCarryOver(TEXT, COMMODITIES, STORAGES);
const decisions = decisionsFromList(STORAGES, entries, { clearOthers: true });
const options = { cropYear: '25/26', clearCommodity: true };
const patch = (name) => patchFor(STORAGES.find((s) => s.name === name), decisions[idOf(name)], options);

check('the silos on the list carry over: commodity and crop year set, stock untouched', () => {
  const p = patch('Kot 3');
  assert.deepEqual(p, { commodityId: 'c-wheat', cropYear: '25/26' });
  assert.ok(!('openingStock' in p) && !('currentHeight' in p), 'their stock and height must not be touched');
});
check('their other quality values are kept', () => {
  const p = patch('43 Silo');
  assert.ok(!('grade' in p) && !('moisturePct' in p));
});
check('every silo not on the list is cleared', () => {
  const p = patch('02 silo (Lancer seed)');
  assert.equal(p.openingStock, 0);
  assert.equal(p.currentHeight, 0);
  assert.equal(p.commodityId, null);
  assert.equal(p.cropYear, '');
  assert.equal(p.grade, '');
  assert.equal(p.moisturePct, null);
  assert.equal(p.proteinPct, null);
  assert.equal(p.fallingNumber, null);
});
check('a cleared silo can keep its commodity if asked', () => {
  const p = patchFor(STORAGES[1], { action: 'clear' }, { cropYear: '25/26', clearCommodity: false });
  assert.ok(!('commodityId' in p));
  assert.equal(p.openingStock, 0);
});
check('a bunker is emptied by its filled length, a silo by its grain height', () => {
  const bunker = { id: 'b', kind: 'bunker', name: 'Bunker', openingStock: 50, length: 30 };
  const p = patchFor(bunker, { action: 'clear' }, options);
  assert.equal(p.length, 0);
  assert.ok(!('currentHeight' in p));
});
check('a tally storage is emptied by its stock figure alone', () => {
  const tally = { id: 't', kind: 'tally', name: 'Shed', openingStock: 40 };
  const p = patchFor(tally, { action: 'clear' }, options);
  assert.equal(p.openingStock, 0);
  assert.ok(!('currentHeight' in p) && !('length' in p));
});
check('"leave alone" changes nothing', () => {
  assert.equal(patchFor(STORAGES[0], { action: 'leave' }, options), null);
  assert.equal(patchFor(STORAGES[0], undefined, options), null);
});

console.log('\n=== the whole farm ===');

check('ten carry over, the rest are cleared, none left alone', () => {
  const s = summarise(STORAGES, decisions, options);
  assert.equal(s.carry, 10);
  assert.equal(s.clear, STORAGES.length - 10);
  assert.equal(s.leave, 0);
  assert.equal(s.changes, STORAGES.length);
});
check('without "clear the others", only the named silos change', () => {
  const d = decisionsFromList(STORAGES, entries, { clearOthers: false });
  const s = summarise(STORAGES, d, options);
  assert.equal(s.carry, 10);
  assert.equal(s.clear, 0);
  assert.equal(s.leave, STORAGES.length - 10);
});
check('the stock that will be lost is listed, so it can be seen before it goes', () => {
  const s = summarise(STORAGES, decisions, options);
  assert.ok(s.stockCleared.some((x) => x.name === '03 Silo' && x.openingStock === 102));
  assert.ok(!s.stockCleared.some((x) => x.name === 'Kot 3'), 'a silo that carries over loses nothing');
});
check('every change names its silo, so the screen can show what it is about to do', () => {
  const all = patchesFor(STORAGES, decisions, options);
  assert.equal(all.length, STORAGES.length);
  assert.ok(all.every((x) => x.storage.id && x.patch));
});

console.log('');
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('ALL PASS');
