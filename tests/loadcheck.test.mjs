// Run with:
//   node tests/loadcheck.test.mjs
import assert from 'node:assert/strict';
import { reconcileLoads } from '../docs/js/loadcheck.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

const load = (ref, field, silo, tons, date = '2026-11-01') => ({ ref, field, silo, deliveryTons: tons, date, problems: [] });
const mv = (ref, fieldId, siloId, tons, extra = {}) => ({
  sourceRef: ref, tons, froms: [{ type: 'field', id: fieldId, tons }], tos: [{ type: 'silo', id: siloId, tons }], ...extra,
});
const maps = { fields: { A07: 'f-a7', B03: 'f-b3' }, silos: { '20 Silo': 's-20' } };

console.log('\n=== comparing the file with the app ===');

check('everything in place: nothing flagged, and each paddock agrees', () => {
  const r = reconcileLoads([load('M1', 'A07', '20 Silo', 30), load('M2', 'B03', '20 Silo', 20)],
    [mv('M1', 'f-a7', 's-20', 30), mv('M2', 'f-b3', 's-20', 20)], maps);
  assert.equal(r.matched, 2);
  assert.equal(r.missing.length + r.wrongField.length + r.wrongSilo.length + r.tonsDiffer.length + r.copies.length, 0);
  assert.deepEqual(r.byField.map((f) => [f.fileTons, f.appTons, f.otherTons]).sort(), [[20, 20, 0], [30, 30, 0]]);
});
check('a load not in the app is reported as missing', () => {
  const r = reconcileLoads([load('M1', 'A07', '20 Silo', 30)], [], maps);
  assert.equal(r.missing.length, 1);
  assert.equal(r.matched, 0);
});
check('a load in a different paddock from the file is reported, with where it went', () => {
  const r = reconcileLoads([load('M1', 'A07', '20 Silo', 30)], [mv('M1', 'f-b3', 's-20', 30)], maps);
  assert.equal(r.wrongField.length, 1);
  assert.equal(r.wrongField[0].expected, 'f-a7');
  assert.equal(r.wrongField[0].actual[0].id, 'f-b3');
});
check('a load with its legs doubled shows as a wrong paddock and as a weight that differs', () => {
  const m = mv('M1', 'f-a7', 's-20', 30);
  m.froms.push({ type: 'field', id: 'f-a7', tons: 30 });
  const r = reconcileLoads([load('M1', 'A07', '20 Silo', 30)], [m], maps);
  assert.equal(r.wrongField.length, 1);
  assert.equal(r.tonsDiffer.length, 1);
  assert.equal(r.byField.find((f) => f.id === 'f-a7').appTons, 60);
});
check('the same movement number twice is reported as copies, and the paddock shows the doubling', () => {
  const r = reconcileLoads([load('M1', 'A07', '20 Silo', 30)], [mv('M1', 'f-a7', 's-20', 30), mv('M1', 'f-a7', 's-20', 30)], maps);
  assert.equal(r.copies.length, 1);
  assert.equal(r.copies[0].count, 2);
  assert.equal(r.byField[0].appTons, 60);
});
check('tonnes from a ticket typed in by hand are counted apart from the file\'s', () => {
  const r = reconcileLoads([load('M1', 'A07', '20 Silo', 30)],
    [mv('M1', 'f-a7', 's-20', 30), { tons: 12, froms: [{ type: 'field', id: 'f-a7', tons: 12 }], tos: [] }], maps);
  const a7 = r.byField.find((f) => f.id === 'f-a7');
  assert.equal(a7.fileTons, 30);
  assert.equal(a7.appTons, 42);
  assert.equal(a7.otherTons, 12);
});
check('a name split by date is compared against the paddock for that date', () => {
  const split = { fields: { 'SR Dam': { cutoff: '2026-11-05', before: 'f-sth', from: 'f-nth' } }, silos: {} };
  const r = reconcileLoads([load('M1', 'SR Dam', 'x', 10, '2026-11-02'), load('M2', 'SR Dam', 'x', 10, '2026-11-08')],
    [mv('M1', 'f-sth', 's', 10), mv('M2', 'f-sth', 's', 10)], split);
  assert.equal(r.wrongField.length, 1);
  assert.equal(r.wrongField[0].load.ref, 'M2');
});
check('a paddock still waiting to be chosen or created is not judged', () => {
  const r = reconcileLoads([load('M1', 'A07', '20 Silo', 30)], [mv('M1', 'f-a7', 's-20', 30)], { fields: { A07: 'pending:A07' }, silos: {} });
  assert.equal(r.wrongField.length, 0);
});
check('loads found by the movement number in the notes, from before it had its own field', () => {
  const m = mv(undefined, 'f-a7', 's-20', 30, { notes: 'Import M1 · APH1' });
  delete m.sourceRef;
  assert.equal(reconcileLoads([load('M1', 'A07', '20 Silo', 30)], [m], maps).matched, 1);
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
