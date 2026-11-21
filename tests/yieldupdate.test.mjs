// Run with:
//   node tests/yieldupdate.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onEstimate, planYieldUpdate } from '../docs/js/yieldupdate.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${(e.stack || e.message).split('\n').slice(0, 3).join('\n        ')}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const f = (id, extra = {}) => ({ id, name: id, commodityId: 'wheat', areaHa: 100, yieldTHa: 3, yieldMode: 'estimate', ...extra });
const fields = [
  f('A'), f('B', { areaHa: 50, yieldTHa: 2.5 }),
  f('C', { yieldMode: 'actual', yieldTHa: 4.1 }),
  f('D', { yieldMode: 'recorded' }),
  f('E', { harvestDone: true }),
  f('F', { yieldMode: undefined }),          // an older paddock with no mode is an estimate
  f('G', { commodityId: 'canola' }),
  f('H', { yieldTHa: 3.5 }),
];

check('only a paddock of the commodity, on an estimate and not finished, counts', () => {
  assert.deepEqual(fields.filter((x) => onEstimate(x, 'wheat')).map((x) => x.id), ['A', 'B', 'F', 'H']);
  assert.equal(onEstimate(null, 'wheat'), false);
});

check('the plan lists what would change, the area and the tonnes before and after', () => {
  const p = planYieldUpdate(fields, 'wheat', 3.5);
  assert.deepEqual(p.changes.map((c) => c.id), ['A', 'B', 'F']);
  assert.equal(p.same, 1, 'H is on 3.5 already');
  assert.equal(p.areaHa, 250);
  assert.equal(p.tonsBefore, 100 * 3 + 50 * 2.5 + 100 * 3);
  assert.equal(p.tonsAfter, 250 * 3.5);
  assert.equal(p.finished, 3, 'C (actual), D (recorded) and E (finished) are left alone');
  assert.deepEqual(p.changes[0], { id: 'A', name: 'A', from: 3, to: 3.5 });
});

check('nothing changes when every paddock on an estimate is already there', () => {
  const p = planYieldUpdate([f('A'), f('B')], 'wheat', 3);
  assert.equal(p.count, 0);
  assert.equal(p.same, 2);
});

check('another commodity is never touched', () => {
  assert.ok(!planYieldUpdate(fields, 'wheat', 9).changes.some((c) => c.id === 'G'));
  assert.equal(planYieldUpdate(fields, 'barley', 9).count, 0);
});

check('the commodity screen offers it: the count, the tonnes, a confirmation, and the default saved with it', () => {
  const s = read('docs/js/views/settings.js');
  assert.ok(s.includes('id="yield-apply"') && s.includes('id="apply-yield"'));
  assert.ok(s.includes('planYieldUpdate(db.get().fields, existing.id'));
  assert.ok(s.includes('askConfirm(`Set ${now.count} field'), 'asks before changing anything');
  assert.ok(s.includes('db.upsertField({ id: c.id, yieldTHa: c.to })'));
  assert.ok(s.includes("db.upsertCommodity({ id: existing.id, defaultYieldTHa"), 'the default is saved with it, so the two agree');
  assert.ok(s.includes("root.querySelector('#defaultYield').addEventListener('input', paintYieldApply)"), 'follows what is typed');
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
