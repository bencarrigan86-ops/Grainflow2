#!/usr/bin/env node
//
// Every table has the same number of columns in its head, body and foot.
//
//   node tests/tables.test.mjs
//
// Written after the third request to move or remove a column. "Move Max t/ha
// to last", "N available second to last", "remove Target calc" — each one is
// three edits in three places, and getting two of the three right produces a
// table that still renders. The browser silently pads or drops the odd cell,
// so the header says Req kg/ha and the number underneath it is App kg/ha, and
// nothing anywhere says so.
//
// On a fert report that is a wrong urea order. This is cheap insurance against
// a mistake that is entirely mine to make.

import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const VIEWS = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'js', 'views');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); }
  catch (e) { failures += 1; console.log(`  FAIL  ${name}\n         ${e.message}`); }
};

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

/**
 * Every <table> in the views, with what each of its three sections declares.
 *
 * Counting <th>/<td> in the source works because each row in this codebase is
 * one literal template — the loop repeats the row, it does not assemble cells
 * one at a time. A table built any other way would come back with no counts
 * rather than wrong ones, so it is skipped rather than guessed at.
 */
function tablesIn(src, file) {
  const out = [];
  const re = /<table>([\s\S]*?)<\/table>/g;
  for (const m of src.matchAll(re)) {
    const block = m[1];
    const section = (tag) => {
      const open = block.indexOf(`<${tag}>`);
      if (open === -1) return null;
      const close = block.indexOf(`</${tag}>`, open);
      return close === -1 ? null : block.slice(open, close);
    };
    // Columns, not cells. The invoice totals row is four cells across five
    // columns because "Total" carries colspan="2" — which is correct markup,
    // and counting cells reported it as a fault on this file's first run.
    const count = (chunk, cell) => {
      if (!chunk) return null;
      let n = 0;
      for (const m of chunk.matchAll(new RegExp(`<${cell}([^>]*)>`, 'g'))) {
        const span = m[1].match(/colspan\s*=\s*["']?(\d+)/i);
        n += span ? Number(span[1]) : 1;
      }
      return n;
    };

    const thead = section('thead');
    const tbody = section('tbody');
    const tfoot = section('tfoot');

    // The first row only. A tbody template renders one <tr> repeatedly; a
    // tfoot is a single row already.
    const firstRow = (chunk) => {
      if (!chunk) return null;
      const at = chunk.indexOf('<tr>');
      if (at === -1) return null;
      const end = chunk.indexOf('</tr>', at);
      return end === -1 ? chunk.slice(at) : chunk.slice(at, end);
    };

    out.push({
      file,
      head: count(firstRow(thead), 'th'),
      body: count(firstRow(tbody), 'td'),
      foot: count(firstRow(tfoot), 'td'),
      label: (firstRow(thead) || '').replace(/\s+/g, ' ').slice(0, 60),
    });
  }
  return out;
}

const tables = walk(VIEWS).flatMap((path) =>
  tablesIn(readFileSync(path, 'utf8'), path.slice(path.indexOf('docs')).replace(/\\/g, '/')));

console.log('\n=== the scan found the tables ===');

check('there are tables to check, including the fert report', () => {
  assert.ok(tables.length >= 8, `only found ${tables.length} tables`);
  assert.ok(tables.some((t) => t.file.endsWith('reports.js') && t.head === 13),
    'the urea table was not found with its 13 columns');
});

console.log('\n=== head, body and foot agree ===');

check('every table body has as many cells as its header has columns', () => {
  const bad = tables
    .filter((t) => t.head !== null && t.body !== null && t.head !== t.body)
    .map((t) => `${t.file}: header ${t.head}, body ${t.body} — ${t.label}`);
  assert.deepEqual(bad, [], `\n         ${bad.join('\n         ')}`);
});

check('and every totals row too', () => {
  // The one most easily forgotten: it is forty lines below the header and
  // reads as a separate thing, but a totals row one cell short slides every
  // total left by one column.
  const bad = tables
    .filter((t) => t.head !== null && t.foot !== null && t.head !== t.foot)
    .map((t) => `${t.file}: header ${t.head}, totals ${t.foot} — ${t.label}`);
  assert.deepEqual(bad, [], `\n         ${bad.join('\n         ')}`);
});

console.log('\n=== the fert report, specifically ===');

const fert = tables.find((t) => t.file.endsWith('reports.js') && t.head === 13);

check('Target calc is gone and nothing was left behind', () => {
  const src = readFileSync(join(VIEWS, 'reports.js'), 'utf8');
  assert.ok(!src.includes('Target calc'), 'the Target calc header is back');
  assert.ok(!src.includes('avgTargetCalc'), 'its unused total is still being computed');
  assert.equal(fert.head, 13);
  assert.equal(fert.body, 13);
  assert.equal(fert.foot, 13);
});

check('the columns Ben asked for are still in the order he asked for', () => {
  // "move the max t/ha column to last", then "and N available to 2nd last".
  const src = readFileSync(join(VIEWS, 'reports.js'), 'utf8');
  const head = src.slice(src.indexOf('<th>Field</th>'));
  const headers = [...head.slice(0, head.indexOf('</tr>')).matchAll(/<th>(.*?)<\/th>/g)].map((m) => m[1]);
  assert.equal(headers[headers.length - 1], 'Max t/ha', `last column is ${headers[headers.length - 1]}`);
  assert.equal(headers[headers.length - 2], 'N avail kg/ha', `second last is ${headers[headers.length - 2]}`);
  assert.equal(headers[0], 'Field', 'the frozen first column is no longer Field');
});

console.log('');
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('ALL PASS');
