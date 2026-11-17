// Run with:
//   node tests/paging.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pageOfRows, PAGE_SIZE } from '../docs/js/paging.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${(e.stack || e.message).split('\n').slice(0, 3).join('\n        ')}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const days = (n, perDay = 1) => Array.from({ length: n }, (_, i) => ({ id: i, date: `2026-11-${String(30 - Math.floor(i / perDay)).padStart(2, '0')}` }));

check('a short list is shown whole', () => {
  const r = pageOfRows(days(10));
  assert.equal(r.rows.length, 10);
  assert.equal(r.hidden, 0);
});

check('a long list shows the latest page and says how many are held back', () => {
  const r = pageOfRows(days(100));
  assert.equal(r.rows.length, PAGE_SIZE);
  assert.equal(r.hidden, 75);
});

check('a day is never cut in half: the page runs on to the end of the day it reaches', () => {
  const rows = days(100, 4);          // four loads a day: 25 loads ends in the middle of day 7
  const r = pageOfRows(rows);
  assert.equal(r.rows.length, 28);
  assert.equal(r.rows[27].date, r.rows[24].date);
  assert.notEqual(rows[28].date, r.rows[27].date);
});

check('asking for more shows more', () => {
  const r = pageOfRows(days(100), PAGE_SIZE * 2);
  assert.equal(r.rows.length, 50);
  assert.equal(r.hidden, 50);
  assert.equal(pageOfRows(days(100), 500).hidden, 0);
});

check('the movement list pages its tickets, searches the whole list, and starts again when the filter changes', () => {
  const src = read('docs/js/views/movements.js');
  assert.ok(src.includes('pageOfRows(shown'), 'the list is paged');
  assert.ok(src.includes('id="mv-more"'), 'there is a Show more button');
  assert.ok(src.includes('listFilter.limit = PAGE_SIZE'), 'a new search or chip starts at the first page again');
  assert.ok(/shown\.reduce\(\(s, m\) => s \+ \(Number\(m\.tons\)/.test(src), 'the totals are of the whole list, not the page');
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
