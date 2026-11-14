// Run with:
//   node tests/fmt.test.mjs
//
// How money is written.
import assert from 'node:assert/strict';
import { money, moneyMillions, dmy, shortDate, tightDate, dmyOfDate } from '../docs/js/fmt.js';

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

check('dates in lists are day-month-year with the whole year, or two digits where it is tight', () => {
  assert.equal(shortDate('2026-01-30'), '30-01-2026');
  assert.equal(shortDate('2027-12-05'), '05-12-2027');
  assert.equal(shortDate('2026-01-30', { tight: true }), '30-01-26');
  assert.equal(tightDate('2027-12-05'), '05-12-27');
  assert.equal(tightDate(''), '');
  assert.equal(shortDate(''), '');
  assert.equal(shortDate('soon'), 'soon');
  assert.equal(shortDate('2026-13-01'), '2026-13-01');
});
check('a moment as a date: 21-12-26, or the long form', () => {
  assert.equal(dmyOfDate(new Date(2026, 11, 21)), '21-12-26');
  assert.equal(dmyOfDate(new Date(2026, 0, 3), true), '03-01-2026');
  assert.equal(dmyOfDate(new Date('nope')), '');
});
check('dates on paperwork are day-month-year', () => {
  assert.equal(dmy('2026-01-30'), '30-01-2026');
  assert.equal(dmy('2026-12-05T10:00:00Z'), '05-12-2026');
  assert.equal(dmy(''), '');
  assert.equal(dmy(null), '');
  assert.equal(dmy('soon'), 'soon');
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
