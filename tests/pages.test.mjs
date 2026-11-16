// Run with:
//   node tests/pages.test.mjs
//
// A farm with seven years of loads has more rows in a table than the server will send in one reply (1,000), and the
// server does not say it stopped. Every table is read a page at a time instead. The fake server here does what
// Supabase does: it cuts every reply at its cap and says nothing.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readAllPages, readAllIn, PAGE_SIZE } from '../docs/js/pages.js';

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** A table of `n` rows and the query builder over it: order, range and in, with the server's silent cap. */
function fakeTable(n, { cap = 1000, fail = false } = {}) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: String(i).padStart(6, '0'), movement_id: `m${i % 7}` }));
  const calls = [];
  const builder = () => {
    let list = rows;
    let from = 0; let to = Infinity; let ordered = false;
    const q = {
      in(col, ids) { list = list.filter((r) => ids.includes(r[col])); return q; },
      order() { ordered = true; return q; },
      range(a, b) { from = a; to = b; return q; },
      then(resolve) {
        calls.push({ from, to, ordered });
        if (fail) return resolve({ data: null, error: { message: 'boom' } });
        const slice = list.slice(from, Math.min(to + 1, from + cap));   // the server stops at its cap, silently
        return resolve({ data: slice, error: null });
      },
    };
    return q;
  };
  return { builder, calls, rows };
}

await check('a table longer than the server cap comes back whole, in order, with no row twice', async () => {
  const t = fakeTable(2500);
  const { data, error } = await readAllPages(t.builder);
  assert.equal(error, null);
  assert.equal(data.length, 2500);
  assert.equal(new Set(data.map((r) => r.id)).size, 2500);
  assert.deepEqual(data.map((r) => r.id), t.rows.map((r) => r.id));
  assert.ok(t.calls.every((c) => c.ordered), 'pages are taken in a fixed order, or rows could repeat or go missing between them');
});

await check('exactly a page, an empty table, and one row over a page', async () => {
  for (const n of [0, 1, PAGE_SIZE - 1, PAGE_SIZE, PAGE_SIZE + 1]) {
    const { data } = await readAllPages(fakeTable(n).builder);
    assert.equal(data.length, n, `${n} rows`);
  }
});

await check('it still gets everything if the server cap is lower than the page size', async () => {
  const { data } = await readAllPages(fakeTable(1800, { cap: 400 }).builder);
  assert.equal(data.length, 1800);
});

await check('an error is returned, not swallowed, and not turned into a short table', async () => {
  const { data, error } = await readAllPages(fakeTable(5, { fail: true }).builder);
  assert.equal(data, null);
  assert.equal(error.message, 'boom');
});

await check('a list of ids is asked for a slice at a time, and every slice is read in full', async () => {
  const t = fakeTable(3000);
  const ids = ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6'];
  const slices = [];
  const { data, error } = await readAllIn((slice) => { slices.push(slice.length); return t.builder().in('movement_id', slice); }, ids, { chunk: 3 });
  assert.equal(error, null);
  assert.equal(data.length, 3000, 'all seven ids, over three slices, with the legs past 1,000 included');
  assert.deepEqual(slices.filter((n, i) => i === 0 || n !== slices[i - 1]).length > 0, true);
  assert.ok(Math.max(...slices) <= 3, 'no slice longer than the chunk');
});

await check('the farm load and the pre-send ticket check both read in pages', () => {
  const h = read('docs/js/hydrate.js');
  assert.ok(h.includes("from './pages.js") && /readAllPages\(build\)/.test(h), 'hydrate');
  assert.ok(/readAllPages\(\(\) => supabase\.rpc\('input_stock_for_worker'/.test(h), 'the worker stock function too');
  const s = read('docs/js/sync.js');
  assert.ok(s.includes("from './pages.js") && s.includes("readAllIn((slice) => supabase.from('movements')") && s.includes("readAllIn((slice) => supabase.from('movement_legs')"), 'sync');
  for (const f of ['docs/js/hydrate.js', 'docs/js/sync.js']) {
    assert.ok(!/await supabase\.from\('(movements|movement_legs)'\)\.select\('\*'\)\.in\(/.test(read(f)), `${f} still has an unpaged read`);
  }
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
