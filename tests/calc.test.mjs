#!/usr/bin/env node
//
// Silo and bunker volumes.
//
//   node tests/calc.test.mjs
//
// The bug this exists for: a silo with no grain in it reported tonnes. The
// formula added the hopper cone and the peaked surface whatever the grain height,
// so an empty 5.9 m silo showed 22 t and an empty 12 m one over 80 t, and the
// Measured column on the Storage tab was wrong by a few thousand tonnes across a
// farm. Nothing looked broken — it was just a number that was never zero.

import assert from 'node:assert';
import { siloResult, bunkerResult } from '../docs/js/calc.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

// 03 Silo from the August backup: radius 2.95 m, 35 degree hopper, barley.
const silo = { radius: 2.95, coneAngle: 35, angleOfRepose: 27, testWeight: 0.68, fillState: 'peak' };

console.log('\n=== an empty silo is empty ===');

check('no grain height means no tonnes, whatever the shape of the silo', () => {
  assert.equal(siloResult({ ...silo, height: 0 }).tons, 0);
  assert.equal(siloResult({ ...silo, height: undefined }).tons, 0);
  assert.equal(siloResult({ ...silo, height: '' }).tons, 0);
  assert.equal(siloResult({ ...silo, height: null }).tons, 0);
  assert.equal(siloResult({ ...silo, height: -1 }).tons, 0, 'a negative height is not a negative amount of grain');
});
check('it is empty on every surface setting, and with a flat bottom', () => {
  for (const fillState of ['peak', 'flat', 'decline']) assert.equal(siloResult({ ...silo, height: 0, fillState }).tons, 0);
  assert.equal(siloResult({ ...silo, height: 0, coneAngle: 0 }).tons, 0);
});
check('an empty silo has no volume either, so nothing downstream sees a phantom cone', () => {
  const r = siloResult({ ...silo, height: 0 });
  assert.equal(r.totalVol, 0);
  assert.equal(r.coneVol, 0);
  assert.equal(r.peakVol, 0);
});

console.log('\n=== a silo with grain in it is unchanged ===');

check('the figures for a silo with grain in it are what they were before the fix', () => {
  // Worked out by hand from the formula, not copied from the code's output.
  const r = (h, fillState = 'peak') => siloResult({ ...silo, height: h, fillState }).tons;
  assert.ok(Math.abs(r(0.5) - 31.4108) < 0.001);
  assert.ok(Math.abs(r(1) - 40.7063) < 0.001);
});
check('flat and declined surfaces still follow the angle of repose', () => {
  const peak = siloResult({ ...silo, height: 2, fillState: 'peak' }).tons;
  const flat = siloResult({ ...silo, height: 2, fillState: 'flat' }).tons;
  const decline = siloResult({ ...silo, height: 2, fillState: 'decline' }).tons;
  assert.ok(peak > flat && flat > decline);
});
check('more grain is never less tonnes', () => {
  let last = 0;
  for (const h of [0.01, 0.5, 1, 2, 4, 8]) {
    const t = siloResult({ ...silo, height: h }).tons;
    assert.ok(t > last, `height ${h}`);
    last = t;
  }
});
check('the cone and peak heights are still reported for the tarp and preview figures', () => {
  const r = siloResult({ ...silo, height: 0 });
  assert.ok(r.coneHeight > 2 && r.peakHeight > 1.4);
});

console.log('\n=== bunkers are not touched ===');

check('a bunker with no filled length is empty, not negative', () => {
  assert.equal(bunkerResult({ width: 20, length: 0, angleDeg: 27, testWeight: 0.68 }).tons, 0);
  assert.equal(bunkerResult({ width: 0, length: 40, angleDeg: 27, testWeight: 0.68 }).tons, 0);
  assert.equal(bunkerResult({ width: 20, length: undefined, angleDeg: 27, testWeight: 0.68 }).tons, 0);
});
check('a heap shorter than the bunker is wide is never a negative amount of grain', () => {
  for (const length of [1, 5, 10]) assert.ok(bunkerResult({ width: 20, length, angleDeg: 27, testWeight: 0.68 }).tons >= 0, `length ${length}`);
});
check('a bunker with grain in it is unchanged', () => {
  const t = bunkerResult({ width: 20, length: 40, angleDeg: 27, testWeight: 0.68 }).tons;
  // 0.25 * tan27 * 20^2 * ((40-20) + pi/6 * 20) * 0.68, worked by hand
  const expected = 0.25 * Math.tan(27 * Math.PI / 180) * 400 * (20 + (Math.PI / 6) * 20) * 0.68;
  assert.ok(Math.abs(t - expected) < 1e-9);
});

console.log('');
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('ALL PASS');
