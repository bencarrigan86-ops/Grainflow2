#!/usr/bin/env node
//
// What is in a silo, and what the next truck will take.
//
//   node tests/outload.test.mjs
//
// The idea is a replay: the opening stock is the bottom layer, each load in puts a
// layer on top, each load out takes grain off the top. What is left is the silo.
// The tests are written around a silo with a history you can follow by eye:
//
//   opening   120 t   carried over, APH1, 11.0% protein
//   ticket 1   30 t   5 Nov   AUH2, 12.4%
//   ticket 2   36 t   6 Nov   APH1, 11.8%
//   ticket 3   36 t   7 Nov   APH1, 12.0%
//
// so the top of the silo is ticket 3, then 2, then 1, then the opening stock.

import assert from 'node:assert';
import { layersForStorage, takeFromEnd, dropFromBands, outloadEndOf, looksLikeBunker, takeFromTop, summarise, predictOutload, predictPlan, specOf, SPECS } from '../docs/js/outload.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

const SILO = { id: 's1', name: '13 Silo', openingStock: 120, grade: 'APH1', proteinPct: 11.0, moisturePct: 11.5 };
const inLoad = (n, date, tons, spec = {}) => ({ id: `m${n}`, ticketNo: n, date, tons, froms: [{ type: 'field', id: 'f1', tons }], tos: [{ type: 'silo', id: 's1', tons }], ...spec });
const outLoad = (n, date, tons) => ({ id: `m${n}`, ticketNo: n, date, tons, froms: [{ type: 'silo', id: 's1', tons }], tos: [{ type: 'sale', id: 'sale1', tons }] });
const MOVES = [
  inLoad(1, '2026-11-05', 30, { grade: 'AUH2', proteinPct: 12.4, moisturePct: 11.0 }),
  inLoad(2, '2026-11-06', 36, { grade: 'APH1', proteinPct: 11.8, moisturePct: 11.2 }),
  inLoad(3, '2026-11-07', 36, { grade: 'APH1', proteinPct: 12.0 }),
];
const tonsOf = (layers) => layers.map((l) => l.tons);

console.log('\n=== replaying a silo\'s history ===');

check('the opening stock is the bottom layer and each load in goes on top', () => {
  const { layers } = layersForStorage(SILO, MOVES);
  assert.deepEqual(tonsOf(layers), [120, 30, 36, 36]);
  assert.deepEqual(layers.map((l) => l.source), ['opening', 'load', 'load', 'load']);
  assert.deepEqual(layers.map((l) => l.ticketNo ?? null), [null, 1, 2, 3]);
});
check('the opening stock takes the silo\'s own quality', () => {
  const { layers } = layersForStorage(SILO, MOVES);
  assert.equal(layers[0].spec.grade, 'APH1');
  assert.equal(layers[0].spec.proteinPct, 11.0);
});
check('a load keeps its own quality', () => {
  const { layers } = layersForStorage(SILO, MOVES);
  assert.equal(layers[1].spec.grade, 'AUH2');
  assert.equal(layers[1].spec.proteinPct, 12.4);
});
check('loads are replayed in the order they happened, whatever order they are held in', () => {
  const shuffled = [MOVES[2], MOVES[0], MOVES[1]];
  assert.deepEqual(layersForStorage(SILO, shuffled).layers.map((l) => l.ticketNo ?? null), [null, 1, 2, 3]);
});
check('the same day is ordered by ticket number', () => {
  const sameDay = [inLoad(9, '2026-11-08', 10), inLoad(8, '2026-11-08', 10)];
  assert.deepEqual(layersForStorage({ id: 's1', openingStock: 0 }, sameDay).layers.map((l) => l.ticketNo), [8, 9]);
});
check('a load out takes grain off the top, last in first out', () => {
  const { layers } = layersForStorage(SILO, [...MOVES, outLoad(4, '2026-11-08', 36)]);
  assert.deepEqual(tonsOf(layers), [120, 30, 36], 'ticket 3 has gone');
  assert.deepEqual(layers.map((l) => l.ticketNo ?? null), [null, 1, 2]);
});
check('a load out can take part of a layer', () => {
  const { layers } = layersForStorage(SILO, [...MOVES, outLoad(4, '2026-11-08', 50)]);
  assert.deepEqual(tonsOf(layers), [120, 30, 22], 'all of ticket 3 and 14 t of ticket 2');
});
check('grain loaded after an outload sits on top of what was left', () => {
  const { layers } = layersForStorage(SILO, [...MOVES, outLoad(4, '2026-11-08', 36), inLoad(5, '2026-11-09', 20, { grade: 'H2' })]);
  assert.deepEqual(layers.map((l) => l.ticketNo ?? null), [null, 1, 2, 5]);
  assert.deepEqual(tonsOf(layers), [120, 30, 36, 20]);
});
check('the layers add up to the stock the books show: opening, plus in, minus out', () => {
  const all = [...MOVES, outLoad(4, '2026-11-08', 50), inLoad(5, '2026-11-09', 20)];
  const { layers, shortfall } = layersForStorage(SILO, all);
  const total = layers.reduce((a, l) => a + l.tons, 0);
  close(total, 120 + 30 + 36 + 36 - 50 + 20);
  assert.equal(shortfall, 0);
});
check('movements that touch other silos are ignored', () => {
  const other = { id: 'x', ticketNo: 6, date: '2026-11-09', tons: 99, froms: [{ type: 'field', id: 'f1', tons: 99 }], tos: [{ type: 'silo', id: 's2', tons: 99 }] };
  assert.deepEqual(tonsOf(layersForStorage(SILO, [...MOVES, other]).layers), [120, 30, 36, 36]);
});
check('a field with the same id as the silo is not mistaken for it', () => {
  const trick = { id: 'y', ticketNo: 6, date: '2026-11-09', tons: 40, froms: [{ type: 'field', id: 's1', tons: 40 }], tos: [{ type: 'silo', id: 's2', tons: 40 }] };
  assert.deepEqual(tonsOf(layersForStorage(SILO, [...MOVES, trick]).layers), [120, 30, 36, 36]);
});
check('more out than ever went in is reported, not turned into negative grain', () => {
  const { layers, shortfall } = layersForStorage({ id: 's1', openingStock: 0 }, [inLoad(1, '2026-11-05', 10), outLoad(2, '2026-11-06', 25)]);
  assert.deepEqual(layers, []);
  assert.equal(shortfall, 15);
});
check('an empty silo with no history has no layers', () => {
  assert.deepEqual(layersForStorage({ id: 's1', openingStock: 0 }, []).layers, []);
});
check('replaying does not alter the movements it is given', () => {
  const before = JSON.stringify(MOVES);
  layersForStorage(SILO, [...MOVES, outLoad(4, '2026-11-08', 50)]);
  assert.equal(JSON.stringify(MOVES), before);
});

console.log('\n=== what the next truck takes ===');

const { layers: NOW } = layersForStorage(SILO, MOVES);

check('the first truck takes the most recent load', () => {
  const p = predictOutload(NOW, 36);
  assert.equal(p.segments.length, 1);
  assert.equal(p.segments[0].layer.ticketNo, 3);
  assert.equal(p.grades[0].grade, 'APH1');
  close(p.specs.proteinPct.avg, 12.0);
});
check('a truck bigger than the top load takes that and then the next', () => {
  const p = predictOutload(NOW, 46);   // all of ticket 3 (36) and 10 t of ticket 2
  assert.deepEqual(p.segments.map((s) => [s.layer.ticketNo, s.tons]), [[3, 36], [2, 10]]);
  close(p.specs.proteinPct.avg, (36 * 12.0 + 10 * 11.8) / 46);
});
check('averages are weighted by tonnes, not by load', () => {
  const p = predictOutload(NOW, 66);   // 36 of ticket 3, 30 of ticket 2
  close(p.specs.proteinPct.avg, (36 * 12.0 + 30 * 11.8) / 66);
});
check('the spread is kept, so a truck that mixes a high and a low shows it', () => {
  const p = predictOutload(NOW, 120);  // tickets 3, 2, 1 and 18 t of the opening stock
  assert.equal(p.specs.proteinPct.min, 11.0);
  assert.equal(p.specs.proteinPct.max, 12.4);
});
check('the grade mix is by tonnes', () => {
  const p = predictOutload(NOW, 90);   // 36 APH1 (t3), 36 APH1 (t2), 18 AUH2 (t1)
  assert.deepEqual(p.grades.map((g) => [g.grade, g.tons]), [['APH1', 72], ['AUH2', 18]]);
  close(p.grades[0].pct, 0.8);
});
check('a load with no moisture recorded is left out of the moisture figure, and counted in its coverage', () => {
  const p = predictOutload(NOW, 72);   // tickets 3 (no moisture) and 2 (11.2)
  close(p.specs.moisturePct.avg, 11.2);
  close(p.specs.moisturePct.coverage, 0.5);
  close(p.specs.proteinPct.coverage, 1);
});
check('a measurement nobody recorded is null, not zero', () => {
  const p = predictOutload(NOW, 36);
  assert.equal(p.specs.fallingNumber, null);
  assert.equal(p.specs.screeningsPct, null);
});
check('grain with no grade recorded is listed as such, not dropped', () => {
  const { layers } = layersForStorage({ id: 's1', openingStock: 0 }, [inLoad(1, '2026-11-05', 20), inLoad(2, '2026-11-06', 10, { grade: 'H2' })]);
  const p = predictOutload(layers, 30);
  assert.deepEqual(p.grades.map((g) => [g.grade, g.tons]), [['', 20], ['H2', 10]].sort((a, b) => b[1] - a[1]));
});
check('asking for more than is in the silo takes what there is and says how much is missing', () => {
  const p = predictOutload(NOW, 300);
  close(p.total, 222);
  close(p.short, 78);
});
check('predicting does not change the silo', () => {
  const before = JSON.stringify(NOW);
  predictOutload(NOW, 100);
  assert.equal(JSON.stringify(NOW), before);
});
check('what is left after a truck is the layers below it', () => {
  const p = predictOutload(NOW, 46);
  assert.deepEqual(tonsOf(p.remaining), [120, 30, 26]);
});

console.log('\n=== a plan of trucks ===');

check('three 36 t trucks come off the top in order, each from what the last left', () => {
  const plan = predictPlan(NOW, 108, 36);
  assert.equal(plan.trucks.length, 3);
  assert.deepEqual(plan.trucks.map((t) => t.segments.map((s) => s.layer.ticketNo)), [[3], [2], [1, null]]);
  assert.equal(plan.short, 0);
});
check('the last truck is the remainder', () => {
  const plan = predictPlan(NOW, 80, 36);
  assert.deepEqual(plan.trucks.map((t) => t.tons), [36, 36, 8]);
});
check('a plan bigger than the silo stops where the grain does, and says so', () => {
  const plan = predictPlan(NOW, 400, 36);
  close(plan.trucks.reduce((a, t) => a + t.total, 0), 222);
  close(plan.short, 178);
});
check('nothing to take means no trucks', () => {
  assert.equal(predictPlan([], 100, 36).trucks.length, 0);
  assert.equal(predictPlan(NOW, 0, 36).trucks.length, 0);
});
check('the trucks together are what one outload of the same size would take', () => {
  const plan = predictPlan(NOW, 108, 36);
  const one = predictOutload(NOW, 108);
  close(plan.trucks.reduce((a, t) => a + t.specs.proteinPct.avg * t.total, 0) / 108, one.specs.proteinPct.avg, 1e-9);
});

console.log('\n=== reading a record\'s quality ===');

check('blank is null, a number is a number, text is trimmed', () => {
  const s = specOf({ grade: ' APH1 ', proteinPct: '', moisturePct: 0, screeningsPct: undefined, testWeightKgHl: '79.5', fallingNumber: 'abc' });
  assert.equal(s.grade, 'APH1');
  assert.equal(s.proteinPct, null);
  assert.equal(s.moisturePct, 0, 'zero moisture is a result, not a blank');
  assert.equal(s.screeningsPct, null);
  assert.equal(s.testWeightKgHl, 79.5);
  assert.equal(s.fallingNumber, null);
});
check('every measurement the screen shows is one the summary computes', () => {
  const p = predictOutload(NOW, 36);
  for (const { key } of SPECS) assert.ok(key in p.specs, key);
});

console.log('\n=== a bunker emptied from the back ===');

const BUNKER = { id: 's1', kind: 'bunker', openingStock: 0 };
const BACK = { ...BUNKER, outloadEnd: 'first' };
const IN3 = [inLoad(1, '2026-11-05', 100, { grade: 'A' }), inLoad(2, '2026-11-06', 100, { grade: 'B' }), inLoad(3, '2026-11-07', 100, { grade: 'C' })];
const gradesOf = (layers) => layers.map((l) => l.spec.grade);

check('last in, first out is the default: the latest grain is taken first', () => {
  assert.equal(outloadEndOf(BUNKER), 'last');
  assert.equal(outloadEndOf({ ...BUNKER, outloadEnd: 'last' }), 'last');
  const { layers } = layersForStorage(BUNKER, [...IN3, outLoad(4, '2026-11-08', 150)]);
  assert.deepEqual([gradesOf(layers), tonsOf(layers)], [['A', 'B'], [100, 50]]);
});
check('emptied from the back, the oldest grain goes first', () => {
  assert.equal(outloadEndOf(BACK), 'first');
  const { layers } = layersForStorage(BACK, [...IN3, outLoad(4, '2026-11-08', 150)]);
  assert.deepEqual([gradesOf(layers), tonsOf(layers)], [['B', 'C'], [50, 100]]);
});
check('only a bunker can be emptied from the back; a silo stays last in, first out', () => {
  assert.equal(outloadEndOf({ id: 's1', kind: 'silo', outloadEnd: 'first' }), 'last');
  assert.equal(outloadEndOf(null), 'last');
  const { layers } = layersForStorage({ id: 's1', kind: 'silo', outloadEnd: 'first', openingStock: 0 }, [...IN3, outLoad(4, '2026-11-08', 150)]);
  assert.deepEqual(gradesOf(layers), ['A', 'B']);
});
check('a load that arrives after one went out lands at the front either way', () => {
  const { layers } = layersForStorage(BACK, [inLoad(1, '2026-11-05', 100, { grade: 'A' }), outLoad(2, '2026-11-06', 40), inLoad(3, '2026-11-07', 50, { grade: 'B' })]);
  assert.deepEqual([gradesOf(layers), tonsOf(layers)], [['A', 'B'], [60, 50]]);
});
check('a storage saved as a silo is still a bunker if it is measured like one or called one', () => {
  assert.equal(looksLikeBunker({ kind: 'bunker' }), true);
  assert.equal(looksLikeBunker({ kind: 'silo', name: 'Bunker 3' }), true);
  assert.equal(looksLikeBunker({ kind: 'silo', name: 'Machinery Shed' }), true);
  assert.equal(looksLikeBunker({ kind: 'silo', name: 'North', width: 20, length: 60 }), true);
  assert.equal(looksLikeBunker({ kind: 'silo', name: 'Silo 12 (155t)', radius: 3.2 }), false);
  assert.equal(looksLikeBunker({ kind: 'silo', name: 'Bunker-like silo', radius: 3.2 }), false, 'a radius means a silo');
  assert.equal(looksLikeBunker({ kind: 'tally', name: 'Bunker tally' }), false);
  assert.equal(looksLikeBunker({ kind: 'silo', name: 'Silo 1' }), false);
  assert.equal(looksLikeBunker(null), false);
  // so its end switch works too
  assert.equal(outloadEndOf({ kind: 'silo', name: 'Bunker 3', outloadEnd: 'first' }), 'first');
  assert.equal(outloadEndOf({ kind: 'silo', name: 'Silo 3', outloadEnd: 'first' }), 'last');
});
check('what is asked for beyond what is in it is still reported as a shortfall', () => {
  const r = layersForStorage(BACK, [inLoad(1, '2026-11-05', 10), outLoad(2, '2026-11-06', 25)]);
  assert.deepEqual([r.layers, r.shortfall], [[], 15]);
});
check('the planner takes trucks from the chosen end', () => {
  const stack = layersForStorage(BUNKER, IN3).layers;
  assert.deepEqual(predictPlan(stack, 150, 100).trucks.map((t) => t.grades.map((g) => g.grade)), [['C'], ['B']]);
  assert.deepEqual(predictPlan(stack, 150, 100, 'first').trucks.map((t) => t.grades[0].grade), ['A', 'B']);
  assert.deepEqual(predictOutload(stack, 120, 'first').grades.map((g) => g.grade), ['A', 'B']);
  assert.deepEqual(takeFromEnd(stack, 120, 'first').remaining.map((l) => l.tons), [80, 100]);
  assert.deepEqual(takeFromTop(stack, 120).remaining.map((l) => l.tons), [100, 80]);
});
check('samples by tonnes from the back move along when the back is emptied after they were taken', () => {
  assert.deepEqual(dropFromBands([{ tons: 100, grade: 'A' }, { tons: 200, grade: 'B' }], 0), [{ tons: 100, grade: 'A' }, { tons: 200, grade: 'B' }]);
  assert.deepEqual(dropFromBands([{ tons: 100, grade: 'A' }, { tons: 200, grade: 'B' }], 150), [{ tons: 150, grade: 'B' }]);
  assert.deepEqual(dropFromBands([{ tons: 100, grade: 'A' }], 100), []);
  const bunker = { ...BACK, openingStock: 300, gradeBands: [{ tons: 100, grade: 'SA' }, { tons: 200, grade: 'SB' }], gradeBandsDate: '2026-11-01' };
  // 150 t taken off the back after the samples: the first stretch and half of the second are gone
  const after = layersForStorage(bunker, [outLoad(2, '2026-11-10', 150)]).layers;
  assert.deepEqual([gradesOf(after), tonsOf(after)], [['SB'], [150]]);
  // taken before the samples were taken: they already describe what was left
  const before = layersForStorage(bunker, [outLoad(2, '2026-10-20', 100)]).layers;
  assert.deepEqual(gradesOf(before), ['SA', 'SB']);
});

console.log('');
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('ALL PASS');
