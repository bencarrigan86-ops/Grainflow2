// Run with:
//   node tests/fmt.test.mjs
//
// How money is written.
import assert from 'node:assert/strict';
import { money, moneyMillions } from '../docs/js/fmt.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

check('money has a dollar sign, commas and no decimals by default', () => {
  assert.equal(money(933715), '$933,715');
  assert.equal(money(1784107), '$1,784,107');
  assert.equal(money(359.4), '$359');
  assert.equal(money(-1200), '-$1,200');
});
check('millions: two decimals and an m', () => {
  assert.equal(moneyMillions(12345678), '$12.35m');
  assert.equal(moneyMillions(10000000), '$10.00m');
  assert.equal(moneyMillions(10000000, 1), '$10.0m');
  assert.equal(moneyMillions(-2500000), '-$2.50m');
});
check('nothing is a dash, not a figure', () => {
  assert.equal(moneyMillions(null), '—');
  assert.equal(moneyMillions(Number.NaN), '—');
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
