// Run with:
//   node tests/trace.test.mjs
//
// Which paddocks the grain on a load came from, worked back through the silos it passed through.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { traceLoads, traceText } from '../docs/js/trace.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const fields = [{ id: 'fA', name: 'A 1', property: 'Aralu' }, { id: 'fB', name: 'B 2', property: 'Back Creek' }];
const silo = (id, extra = {}) => ({ id, name: id.toUpperCase(), kind: 'silo', radius: 4, openingStock: 0, ...extra });
const load = (id, date, froms, tos, extra = {}) => ({ id, date, ticketNo: Number(id.replace(/\D/g, '')) || 0, froms, tos, tons: tos.reduce((a, l) => a + l.tons, 0) || froms.reduce((a, l) => a + l.tons, 0), ...extra });
const f = (id, tons) => ({ type: 'field', id, tons });
const s = (id, tons) => ({ type: 'silo', id, tons });
const sale = (id, tons) => ({ type: 'sale', id, tons });
const obj = (m) => Object.fromEntries([...m].map(([k, v]) => [k, Math.round(v * 100) / 100]));

console.log('\n=== one silo, last in first out ===');
const storages = [silo('s1')];
const moves = [
  load('m1', '2026-11-01', [f('fA', 20)], [s('s1', 20)]),
  load('m2', '2026-11-02', [f('fB', 30)], [s('s1', 30)]),
  load('m3', '2026-11-03', [s('s1', 35)], [sale('x', 35)]),
  load('m4', '2026-11-04', [s('s1', 15)], [sale('x', 15)]),
];
const t = traceLoads(storages, moves);
check('a load straight from a paddock names the paddock', () => {
  assert.deepEqual(obj(t.get('m1')), { 'field:fA': 20 });
});
check('the first truck out takes the top: all of B 2, then 5 t of A 1', () => {
  assert.deepEqual(obj(t.get('m3')), { 'field:fB': 30, 'field:fA': 5 });
});
check('what is left is what the earlier trucks did not take', () => {
  assert.deepEqual(obj(t.get('m4')), { 'field:fA': 15 });
});
check('every tonne in is a tonne out: the paddock totals add up to what was loaded', () => {
  const out = new Map();
  for (const id of ['m3', 'm4']) for (const [k, v] of t.get(id)) out.set(k, (out.get(k) || 0) + v);
  assert.equal(Math.round(out.get('field:fA')), 20);
  assert.equal(Math.round(out.get('field:fB')), 30);
});

console.log('\n=== first in, first out from the back of a bunker ===');
check('a bunker emptied from the back gives the oldest grain first', () => {
  const b = [silo('b1', { kind: 'bunker', outloadEnd: 'first', radius: 0, width: 10, length: 20 })];
  const r = traceLoads(b, [
    load('m1', '2026-11-01', [f('fA', 20)], [s('b1', 20)]),
    load('m2', '2026-11-02', [f('fB', 30)], [s('b1', 30)]),
    load('m3', '2026-11-03', [s('b1', 25)], [sale('x', 25)]),
  ]);
  assert.deepEqual(obj(r.get('m3')), { 'field:fA': 20, 'field:fB': 5 });
});

console.log('\n=== silo to silo, opening stock and the unknown ===');
check('grain moved silo to silo carries its paddocks with it', () => {
  const r = traceLoads([silo('s1'), silo('s2')], [
    load('m1', '2026-11-01', [f('fA', 10)], [s('s1', 10)]),
    load('m2', '2026-11-02', [f('fB', 10)], [s('s1', 10)]),
    load('m3', '2026-11-03', [s('s1', 10)], [s('s2', 10)]),
    load('m4', '2026-11-04', [s('s2', 4)], [sale('x', 4)]),
  ]);
  assert.deepEqual(obj(r.get('m3')), { 'field:fB': 10 });
  assert.deepEqual(obj(r.get('m4')), { 'field:fB': 4 });
});
check('a mixed layer is shared out in proportion when only part of it moves', () => {
  const r = traceLoads([silo('s1'), silo('s2')], [
    load('m1', '2026-11-01', [f('fA', 10), f('fB', 10)], [s('s1', 20)]),
    load('m2', '2026-11-02', [s('s1', 10)], [s('s2', 10)]),
    load('m3', '2026-11-03', [s('s2', 10)], [sale('x', 10)]),
  ]);
  assert.deepEqual(obj(r.get('m3')), { 'field:fA': 5, 'field:fB': 5 });
});
check('opening stock has no paddock and is named for the silo; taking more than there is says not recorded', () => {
  const r = traceLoads([silo('s1', { openingStock: 8 })], [
    load('m1', '2026-11-01', [f('fA', 4)], [s('s1', 4)]),
    load('m2', '2026-11-02', [s('s1', 15)], [sale('x', 15)]),
  ]);
  assert.deepEqual(obj(r.get('m2')), { 'field:fA': 4, 'opening:s1': 8, unknown: 3 });
});
check('an off-farm store is named for the store, and loads are replayed by date then ticket, not list order', () => {
  const r = traceLoads([silo('s1'), silo('o1', { offFarm: { operator: 'GrainCorp' } })], [
    load('m2', '2026-11-02', [s('s1', 5)], [sale('x', 5)]),
    load('m1', '2026-11-01', [f('fA', 5)], [s('s1', 5)]),
    load('m3', '2026-11-03', [s('o1', 6)], [sale('x', 6)]),
  ]);
  assert.deepEqual(obj(r.get('m2')), { 'field:fA': 5 });
  assert.deepEqual(obj(r.get('m3')), { 'offfarm:o1': 6 });
});
check('nothing recorded gives nothing', () => {
  assert.equal(traceLoads([], []).size, 0);
  const r = traceLoads([silo('s1')], [load('m1', '2026-11-01', [], [sale('x', 5)])]);
  assert.equal(r.get('m1').size, 0);
  assert.equal(traceText(r.get('m1')), '');
  assert.equal(traceText(undefined), '');
});

console.log('\n=== the words ===');
check('biggest first, with the farm name, and names for the rest', () => {
  const m = new Map([['field:fA', 5], ['field:fB', 30], ['opening:s1', 2], ['offfarm:o1', 1], ['unknown', 0.5], ['field:gone', 0.004]]);
  const txt = traceText(m, { fields, storages: [silo('s1'), silo('o1')] });
  assert.equal(txt, 'Back Creek B 2 30 t; Aralu A 1 5 t; Opening stock in S1 2 t; O1 (off-farm) 1 t; Not recorded 0.5 t');
  assert.match(traceText(new Map([['field:gone', 3]]), { fields }), /no longer on the list 3 t/);
});

console.log('\n=== the export ===');
check('the movements CSV has the column, and the silo replay is the one outload.js uses', () => {
  const v = read('docs/js/views/settingsexport.js');
  assert.ok(v.includes('traceLoads(data.storages, movements)') && v.includes("'Fields it came from (t)'") && v.includes('traceText(traced.get(m.id), data)'));
  assert.ok(read('docs/js/trace.js').includes("inOrder, outloadEndOf } from './outload.js"));
});

console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
process.exit(failures ? 1 : 0);
