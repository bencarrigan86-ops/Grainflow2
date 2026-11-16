// Run with:
//   node tests/pages.test.mjs
//
// A farm with seven years of loads has more rows in a table than the server will send in one reply (1,000), and the
// server does not say it stopped. A table that does not fit in one reply is read a page at a time. A table that does is
// used exactly as the server sent it, so the lists on screen keep the order they always had (reading everything sorted
// by id put the commodities, paddocks and silos in a random order). The fake server here does what Supabase does: it
// cuts every reply at its cap and says nothing, except for the total it reports when asked.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readAllPages, readAllIn, PAGE_SIZE } from '../docs/js/pages.js';

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/**
 * A table of `n` rows and the query builder over it: in, order, range, with the server's silent cap. Unsorted, the
 * server sends the rows in the order they were saved, which is NOT the order of their ids (those are random).
 */
function fakeTable(n, { cap = 1000, fail = false, count = true } = {}) {
  // saved in order 0..n-1; each has an id that sorts the other way round, and a time that does not (a batch shares one)
  const rows = Array.from({ length: n }, (_, i) => ({ id: String(n - i).padStart(6, '0'), created_at: `2026-01-0${1 + (i % 3)}`, movement_id: `m${i % 7}`, saved: i }));
  const calls = [];
  const builder = () => {
    let list = rows;
    let from = 0; let to = Infinity; const orders = [];
    const q = {
      in(col, ids) { list = list.filter((r) => ids.includes(r[col])); return q; },
      order(k) { orders.push(k); return q; },
      range(a, b) { from = a; to = b; return q; },
      then(resolve) {
        calls.push({ from, to, orders: [...orders] });
        if (fail) return resolve({ data: null, error: { message: 'boom' }, count: null });
        let out = list;
        if (orders.length) out = [...list].sort((x, y) => { for (const k of orders) { const c = String(x[k]).localeCompare(String(y[k])); if (c) return c; } return 0; });
        const slice = out.slice(from, Math.min(to + 1, from + cap));   // the server stops at its cap, silently
        return resolve({ data: slice, error: null, count: count ? list.length : null });
      },
    };
    return q;
  };
  return { builder, calls, rows };
}

await check('a table that fits in one reply is used as the server sent it: same order, one request, nothing sorted', async () => {
  const t = fakeTable(40);
  const { data, error } = await readAllPages(t.builder);
  assert.equal(error, null);
  assert.deepEqual(data.map((r) => r.saved), Array.from({ length: 40 }, (_, i) => i), 'the order the rows were saved in, not the order of their ids');
  assert.equal(t.calls.length, 1);
  assert.deepEqual(t.calls[0].orders, []);
});

await check('a table longer than the server cap comes back whole, with no row twice, read in a fixed order', async () => {
  const t = fakeTable(2500);
  const { data, error } = await readAllPages(t.builder);
  assert.equal(error, null);
  assert.equal(data.length, 2500);
  assert.equal(new Set(data.map((r) => r.id)).size, 2500);
  const paged = t.calls.slice(1);
  assert.ok(paged.length >= 3 && paged.every((c) => c.orders.join() === 'created_at,id'), 'pages are taken sorted, or rows could repeat or go missing between them');
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

await check('a server that does not report the total is never taken for complete', async () => {
  const t = fakeTable(2500, { count: false });
  const { data } = await readAllPages(t.builder);
  assert.equal(data.length, 2500);
  assert.ok(t.calls.length > 1);
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
  assert.ok(Math.max(...slices) <= 3, 'no slice longer than the chunk');
});

await check('the farm load and the pre-send ticket check both read in pages, and ask for the total', () => {
  const h = read('docs/js/hydrate.js');
  assert.ok(h.includes("from './pages.js") && /readAllPages\(build\)/.test(h), 'hydrate');
  assert.ok(h.includes("select('*', { count: 'exact' })"), 'the total is asked for');
  assert.ok(/readAllPages\(\(\) => supabase\.rpc\('input_stock_for_worker'/.test(h), 'the worker stock function too');
  const s = read('docs/js/sync.js');
  assert.ok(s.includes("from './pages.js") && s.includes("readAllIn((slice) => supabase.from('movements')") && s.includes("readAllIn((slice) => supabase.from('movement_legs')"), 'sync');
  assert.ok(s.includes("select('*', { count: 'exact' })"));
  for (const f of ['docs/js/hydrate.js', 'docs/js/sync.js']) {
    assert.ok(!/await supabase\.from\('(movements|movement_legs)'\)\.select\('\*'\)\.in\(/.test(read(f)), `${f} still has an unpaged read`);
  }
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
