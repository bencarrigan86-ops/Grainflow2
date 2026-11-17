// Run with:
//   node tests/gmcost.test.mjs
//
// A commodity's gross margin cost: dollars per hectare over the hectares sown gives the total, and the total over the hectares gives it back.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSION } from '../docs/js/version.js';
const stamp = APP_VERSION.split('.').pop();
const { totalFromPerHa, perHaFromTotal, commodityAreaHa } = await import(`../docs/js/gmcost.js?v=${stamp}`);

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

check('$/ha over the hectares gives the total, and the total gives $/ha back', () => {
  assert.equal(totalFromPerHa(350, 400), 140000);
  assert.equal(perHaFromTotal(140000, 400), 350);
  assert.equal(totalFromPerHa('412.5', 102), 42075);
  assert.equal(perHaFromTotal(1000, 3), 333.33);
});
check('no area, nothing typed, or rubbish gives 0 rather than NaN or Infinity', () => {
  assert.equal(totalFromPerHa(350, 0), 0);
  assert.equal(perHaFromTotal(140000, 0), 0);
  assert.equal(totalFromPerHa('', 400), 0);
  assert.equal(perHaFromTotal('abc', 400), 0);
  assert.equal(totalFromPerHa(undefined, undefined), 0);
});
check('the hectares sown to a commodity are its fields added up', () => {
  const fields = [{ commodityId: 'w', areaHa: 100 }, { commodityId: 'w', areaHa: '20.5' }, { commodityId: 'b', areaHa: 50 }, { commodityId: 'w' }];
  assert.equal(commodityAreaHa(fields, 'w'), 120.5);
  assert.equal(commodityAreaHa(fields, 'zz'), 0);
  assert.equal(commodityAreaHa(fields, undefined), 0, 'a new commodity has no fields yet');
});
check('it is wired: both boxes on the commodity form, each filling the other, and only the total is saved', () => {
  const s = read('docs/js/views/settings.js');
  assert.ok(s.includes("id: 'gmCostHa'") && s.includes("id: 'gmCost'"));
  assert.ok(s.includes('totalFromPerHa(gmHa.value, gmArea)') && s.includes('perHaFromTotal(gmTotal.value, gmArea)'));
  assert.ok(s.includes("grossMarginCost: getNum(root, 'gmCost')"));
  assert.ok(!/gmCostHa.*getNum|getNum\(root, 'gmCostHa'\)/.test(s), '$/ha is never saved: the total is what is kept');
});

console.log('');
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('all passed');
