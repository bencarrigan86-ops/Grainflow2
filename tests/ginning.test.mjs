// Run with:
//   node tests/ginning.test.mjs
//
// A cotton ginning run: modules in, lint and seed out, priced on the 227 kg standard bale. The figures are the real gin invoice
// I053/23 (90,273 kg of lint, 393 bales pressed): $65.00 a bale to gin, $2.25 research levy, GST on the ginning only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STD_BALE_KG, cleanGin, hasGin, stdBales, turnoutPct, seedTonnes, seedKgPerBale, ginInvoice, describeGin, ginDeduction } from '../docs/js/ginning.js';
import { saleEconomics } from '../docs/js/derived.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${(e.stack || e.message).split('\n').slice(0, 3).join('\n        ')}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const run = { ginName: 'Brighann Ginning', invoiceNo: 'I053/23', modules: 18, moduleKg: 222230, physicalBales: 393, lintKg: 90273, seedKg: 99418, ginRate: 65, researchLevy: 2.25 };

check('the standard bale is the lint weight over 227 kg, not the count of bales pressed', () => {
  assert.equal(STD_BALE_KG, 227);
  assert.ok(Math.abs(stdBales(90273) - 397.678) < 0.001, 'I053/23 says 397.678');
  assert.equal(stdBales(0), 0);
  assert.equal(stdBales(227), 1);
  assert.equal(stdBales(454, 0), 2, 'a bale weight of nothing falls back to 227');
});

check('the gin invoice comes to what the gin charged: $25,849.10 + $2,584.91 GST + $894.78 levy = $29,328.79', () => {
  const inv = ginInvoice(run);
  assert.equal(inv.ginning, 25849.10);
  assert.equal(inv.gst, 2584.91);
  assert.equal(inv.research, 894.78);
  assert.equal(inv.total, 29328.79);
});

check('the voluntary Cotton Australia levy is a line of its own, with no GST', () => {
  const inv = ginInvoice({ ...run, voluntaryLevy: 1.5 });
  assert.equal(inv.voluntary, 596.52, '397.678 x $1.50');
  assert.equal(inv.levies, 1491.30);
  assert.equal(inv.gst, 2584.91, 'the GST is on the ginning only');
  assert.equal(inv.exGst, 27340.40);
  assert.equal(inv.total, 29925.31);
  assert.equal(ginInvoice({ ...run, gstOnGin: false }).gst, 0);
});

check('turnout, seed tonnes and seed per bale', () => {
  assert.ok(Math.abs(turnoutPct(90273, 222230) - 40.62) < 0.01, 'the gin says 40.62%');
  assert.equal(seedTonnes(99418), 99.418);
  assert.ok(Math.abs(seedKgPerBale(90273, 99418) - 250) < 0.1, 'about 250 kg of seed for each bale');
  assert.equal(turnoutPct(5, 0), 0);
});

check('a run is tidied for saving: numbers, trimmed text, a bale weight that is never zero', () => {
  const g = cleanGin({ ginName: '  Brighann ', modules: '18', lintKg: '90273', stdBaleKg: 0, gstOnGin: undefined });
  assert.equal(g.ginName, 'Brighann');
  assert.equal(g.modules, 18);
  assert.equal(g.stdBaleKg, 227);
  assert.equal(g.gstOnGin, true);
  assert.equal(cleanGin(null), null);
  assert.equal(hasGin({ gin: g }), true);
  assert.equal(hasGin({}), false);
});

check('the run reads in words for the movement list', () => {
  assert.equal(describeGin(run), '18 modules → 393 bales (397.68 std), 99.4 t seed');
  assert.equal(describeGin({ modules: 1, lintKg: 227 }), '1 module → (1.00 std)');
});

check('when the lint buyer pays the gin, the ginning and levies come off the contract, not into the bills', () => {
  const sale = { id: 's1', price: 593.57, tons: 500, contractNo: 'P23-139' };
  const gin = { ...run, voluntaryLevy: 1.5, paidBy: 'buyer' };
  const lint = Math.round(stdBales(90273) * 1000) / 1000;   // as saved on the leg
  const move = (g, to) => ({ id: 'm1', date: '2026-05-18', tons: lint, froms: [], tos: [{ type: to, id: 's1', tons: lint }], gin: g });
  const d = ginDeduction(sale, [move(gin, 'sale')]);
  assert.equal(d.total, 27340.40, 'ginning + research + voluntary, ex GST');
  assert.equal(d.runs, 1);
  assert.equal(ginDeduction(sale, [move({ ...gin, paidBy: 'us' }, 'sale')]).total, 0, 'a run we pay is a bill, not a deduction');
  assert.equal(ginDeduction(sale, [move(gin, 'silo')]).total, 0, 'lint in a storage is not on the contract yet');
  assert.equal(ginDeduction({ id: 'other' }, [move(gin, 'sale')]).total, 0);
  const half = { ...move(gin, 'sale'), tos: [{ type: 'sale', id: 's1', tons: lint / 2 }] };
  assert.equal(ginDeduction(sale, [half]).total, 13670.20, 'only the share of the run delivered to this contract');
  const base = saleEconomics(sale, []).totalValue;
  const e = saleEconomics(sale, [move(gin, 'sale')]);
  assert.equal(e.ginDeduction, 27340.40);
  assert.equal(Math.round((base - e.totalValue) * 100) / 100, 27340.40, 'and the contract is worth that much less');
  assert.equal(cleanGin({}).paidBy, 'us', 'a run saved before this existed is ours to pay');
});

check('the sheet asks who pays the gin and defaults it from where the lint goes', () => {
  const g = read('docs/js/views/ginrun.js');
  assert.ok(g.includes("id: 'g-paid-by'") && g.includes('The lint buyer pays it and takes it off the lint payment'));
  assert.ok(g.includes("g.paidBy === 'us' && inv.bales > 0"), 'only a run we pay becomes a bill');
  assert.ok(g.includes("lintLeg?.type === 'sale' ? 'buyer' : 'us'"));
});

check('the run goes to the server and comes back, and a movement without one sends no column', () => {
  const st = (m) => ({ currentYear: '2026', years: { 2026: { sales: [], commodities: [], fields: [], storages: [], movements: [m] } }, businessDetails: {} });
  const base = { id: 'm1', date: '2026-05-18', tons: 397.678, froms: [], tos: [] };
  const rows = stateToRows(st({ ...base, gin: cleanGin(run) }), 'farm1');
  assert.equal(rows.movements[0].gin.lintKg, 90273);
  assert.deepEqual(rowsToState(rows).years[2026].movements[0].gin, cleanGin(run));
  assert.ok(!('gin' in stateToRows(st(base), 'farm1').movements[0]));
});

check('the movement list and the ticket form hand a ginning run to its own sheet, and keep it out of the tonnes moved', () => {
  const m = read('docs/js/views/movements.js');
  assert.ok(m.includes('if (existing && hasGin(existing)) return openGinRunSheet(existing);'));
  assert.ok(m.includes("id=\"log-ginning\"") && m.includes('openGinRunSheet(null)'));
  assert.ok(m.includes('shown.filter((m) => !hasGin(m))'));
  assert.ok(m.includes('describeGin(m.gin)'));
  const g = read('docs/js/views/ginrun.js');
  assert.ok(g.includes("id: 'g-lint-to'") && g.includes("id: 'g-seed-to'") && g.includes('We pay it (saved as a bill)'));
  assert.ok(g.includes('Voluntary levy ($/bale)') && g.includes('db.upsertPayable'));
  assert.ok(read('docs/js/storage.js').includes('rec.__hasGin = true'));
  assert.ok(read('supabase/migrations/20261127000000_movement_gin.sql').includes('add column if not exists gin jsonb'));
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('add column if not exists gin jsonb'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
