// Run with:
//   node tests/ginning.test.mjs
//
// A cotton ginning run: modules in, lint and seed out, priced on the 227 kg standard bale. The figures are the real gin invoice
// I053/23 (90,273 kg of lint, 393 bales pressed): $65.00 a bale to gin, $2.25 research levy, GST on the ginning only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STD_BALE_KG, cleanGin, hasGin, stdBales, turnoutPct, seedTonnes, seedKgPerBale, ginInvoice, describeGin, ginDeduction, parseBale, baleRangeCount, cleanAllocations, allocateLint, allocationProblems, cleanCotton, hasCotton, cottonComponents, cottonRunTotals, SEED_FACTOR_DEFAULT, ginPrepaid, lotsForSale } from '../docs/js/ginning.js';
import { saleEconomics, position, positionAtYield, invoiceLineItems, invoiceTotals } from '../docs/js/derived.js';
import { cottonInvoiceModel, mergeBaleRanges } from '../docs/js/cottoninvoice.js';
import { xeroInvoices } from '../docs/js/xero.js';
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
  assert.equal(e.totalValue, base, 'the contract value is not changed by the gin: it is a deduction from the payment, not the price');
  assert.equal(e.priceExFarm, saleEconomics(sale, []).priceExFarm, 'nor is the price');
  assert.equal(Math.round((base - e.netPayment) * 100) / 100, 27340.40, 'but the payment is that much less');
  assert.equal(saleEconomics(sale, []).netPayment, base, 'with no gin deduction the payment is the value');
  assert.equal(cleanGin({}).paidBy, 'us', 'a run saved before this existed is ours to pay');
});

check('the sheet asks who pays the gin and defaults it from where the lint goes', () => {
  const g = read('docs/js/views/ginrun.js');
  assert.ok(g.includes("id: 'g-paid-by'") && g.includes('The lint buyer pays it and takes it off the lint payment'));
  assert.ok(g.includes("g.paidBy === 'us' && inv.bales > 0"), 'only a run we pay becomes a bill');
  assert.ok(g.includes("parseTarget(startAllocs[0].to)?.type === 'sale' ? 'buyer' : 'us'"));
});

const lot = (to, baleFrom, baleTo) => ({ to, baleFrom, baleTo });
const split = { ...run, baleFrom: 'BG027234', baleTo: 'BG027626', paidBy: 'buyer', voluntaryLevy: 1.5 };

check('a bale range counts both ends: BG027234 to BG027626 is the 393 bales pressed', () => {
  assert.equal(baleRangeCount('BG027234', 'BG027626'), 393);
  assert.equal(baleRangeCount('bg027234', 'BG027234'), 1, 'one bale, any case');
  assert.equal(baleRangeCount('BG027234', 'XX027626'), null, 'different letters is not a range');
  assert.equal(baleRangeCount('BG027626', 'BG027234'), null, 'backwards is not a range');
  assert.equal(baleRangeCount('', 'BG1'), null);
  assert.deepEqual(parseBale('BG027234'), { prefix: 'BG', n: 27234, width: 6 });
});

check('one lot with no range takes the whole run', () => {
  const a = allocateLint({ ...split, allocations: [lot('sale:s1', '', '')] });
  assert.equal(a.length, 1);
  assert.equal(a[0].bales, 393);
  assert.ok(Math.abs(a[0].std - 397.678) < 0.001);
  assert.deepEqual(allocationProblems({ ...split, allocations: [lot('sale:s1', '', '')] }), []);
  assert.equal(allocateLint(split).length, 1, 'a run with no allocations is one whole lot too');
});

check('a run split by bale range shares the lint weight by bales, and the lots add back to the run', () => {
  const g = { ...split, allocations: [lot('sale:s1', 'BG027234', 'BG027400'), lot('silo:st1', 'BG027401', 'BG027626')] };
  const a = allocateLint(g);
  assert.deepEqual(a.map((x) => x.bales), [167, 226]);
  assert.ok(Math.abs(a[0].std - 168.988) < 0.001 && Math.abs(a[1].std - 228.690) < 0.001);
  assert.ok(Math.abs(a[0].std + a[1].std - 397.678) < 0.001);
  assert.deepEqual(allocationProblems(g), []);
});

check('bad allocations are named: a gap, an overlap, outside the run, not a range, a wrong count', () => {
  const p = (allocations) => allocationProblems({ ...split, allocations }).join(' | ');
  assert.match(p([lot('a', 'BG027234', 'BG027400')]), /167 of the 393 bales are allocated/);
  assert.match(p([lot('a', 'BG027234', 'BG027400'), lot('b', 'BG027400', 'BG027626')]), /overlap/);
  assert.match(p([lot('a', 'BG027200', 'BG027626')]), /outside this run/);
  assert.match(p([lot('a', 'BG027626', 'BG027234')]), /not a bale range/);
  assert.match(allocationProblems({ ...split, physicalBales: 400 }).join(' '), /range is 393 bales but 400 were pressed/);
  assert.equal(cleanAllocations([lot('', '', ''), lot('sale:s1', ' BG1 ', 'BG9')]).length, 1, 'a blank lot is dropped');
});

check('when the buyer pays the gin, each contract is charged for the bales in its range only', () => {
  const g = { ...split, allocations: [lot('sale:s1', 'BG027234', 'BG027400'), lot('sale:s2', 'BG027401', 'BG027626')] };
  const legs = allocateLint(g).map((a) => ({ type: 'sale', id: a.to.slice(5), tons: Math.round(a.std * 1000) / 1000 }));
  const m = { id: 'm1', date: '2026-05-18', tons: 397.678, froms: [], tos: legs, gin: g };
  const d1 = ginDeduction({ id: 's1' }, [m]);
  const d2 = ginDeduction({ id: 's2' }, [m]);
  assert.ok(Math.abs(d1.total + d2.total - 27340.40) < 0.02, 'the two shares make the whole invoice');
  assert.ok(Math.abs(d1.total - 27340.40 * (167 / 393)) < 0.02);
  assert.equal(ginDeduction({ id: 's3' }, [m]).total, 0);
});

check('the sheet takes lint by bale range, with a lot per contract or storage, and warns before saving a mismatch', () => {
  const g = read('docs/js/views/ginrun.js');
  assert.ok(g.includes('class="al-from"') && g.includes('class="al-last"') && g.includes('id="g-al-add"'));
  assert.ok(g.includes('allocateLint(g)') && g.includes('allocationProblems(g)') && g.includes('Save anyway'));
  assert.ok(!g.includes("id: 'g-lint-to'"), 'the single lint select is gone');
  assert.ok(read('docs/css/styles.css').includes('.al-range {'));
});

check('allocations ride in the gin record to the server and back', () => {
  const g = cleanGin({ ...split, allocations: [lot('sale:s1', 'BG027234', 'BG027400'), lot('silo:st1', 'BG027401', 'BG027626')], seedTo: 'silo:st2' });
  const st = { currentYear: '2026', years: { 2026: { sales: [], commodities: [], fields: [], storages: [], movements: [{ id: 'm1', date: '2026-05-18', tons: 397.678, froms: [], tos: [], gin: g }] } }, businessDetails: {} };
  const back = rowsToState(stateToRows(st, 'farm1')).years[2026].movements[0].gin;
  assert.deepEqual(back.allocations, g.allocations);
  assert.equal(back.seedTo, 'silo:st2');
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
  assert.ok(g.includes("id: 'g-seed-to'") && g.includes('We pay it (saved as a bill)'));
  assert.ok(g.includes('Voluntary levy ($/bale)') && g.includes('db.upsertPayable'));
  assert.ok(read('docs/js/storage.js').includes('rec.__hasGin = true'));
  assert.ok(read('supabase/migrations/20261127000000_movement_gin.sql').includes('add column if not exists gin jsonb'));
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('add column if not exists gin jsonb'));
});

const cotCom = { id: 'cot', name: 'Cotton', unit: 'bale', mtmPrice: 600, openingStock: 0, retainedSeed: 0, cotton: { seedMtm: 500, ginRate: 65, levies: 3.75 } };
const cotField = { id: 'f1', name: 'Cotton paddock', areaHa: 100, commodityId: 'cot', yieldTHa: 10 };   // 1,000 bales
const ranMove = { id: 'm1', date: '2026-05-18', commodityId: 'cot', tons: 397.678, froms: [], tos: [], gin: { ...run, voluntaryLevy: 1.5 } };

check('seed per bale falls back to 0.245 t and the settings are tidied', () => {
  assert.equal(SEED_FACTOR_DEFAULT, 0.245);
  assert.equal(cleanCotton(null), null);
  assert.deepEqual(cleanCotton({ seedMtm: '500', ginRate: '65' }), { seedMtm: 500, seedFactor: 0, ginRate: 65, levies: 0 });
  assert.equal(hasCotton({}), false);
  assert.equal(hasCotton({ levies: 3 }), true);
});

check('before any run: seed is bales x seed per bale at the seed price, ginning is bales x (ginning + levies)', () => {
  const c = cottonComponents(cotCom.cotton, 1000);
  assert.equal(c.seedT, 245);
  assert.equal(c.seedValue, 122500);
  assert.equal(c.ginningCost, 68750);
  assert.equal(cottonComponents({ ...cotCom.cotton, seedFactor: 0.25 }, 1000).seedT, 250);
});

check('logged runs replace the estimate for the bales they ginned, the rest stay estimated', () => {
  const r = cottonRunTotals([ranMove, { ...ranMove, id: 'other', commodityId: 'wheat' }, { id: 'plain', commodityId: 'cot' }], 'cot');
  assert.equal(r.runs, 1);
  assert.ok(Math.abs(r.bales - 397.678) < 0.001 && Math.abs(r.seedT - 99.418) < 0.0001);
  assert.equal(r.exGst, 27340.40);
  const c = cottonComponents(cotCom.cotton, 1000, r);
  assert.ok(Math.abs(c.unginnedBales - 602.322) < 0.001);
  assert.ok(Math.abs(c.seedT - (99.418 + 602.322 * 0.245)) < 0.001);
  assert.ok(Math.abs(c.ginningCost - (27340.40 + 602.322 * 68.75)) < 0.1);
  assert.equal(cottonComponents(cotCom.cotton, 100, r).ginnedBales, 100, 'never more ginned than bales');
});

check('the position of cotton is the lint, plus the seed, less the ginning; other commodities are unchanged', () => {
  const wheat = { id: 'w', name: 'Wheat', unit: 't', mtmPrice: 400 };
  const wf = { id: 'f2', name: 'W', areaHa: 100, commodityId: 'w', yieldTHa: 3 };
  const rows = position([cotCom, wheat], [cotField, wf], [], []);
  const cot = rows.find((r) => r.commodity.id === 'cot');
  assert.equal(cot.unsoldValue, 1000 * 600);
  assert.equal(cot.cotton.seedValue, 122500);
  assert.equal(cot.totalValue, 600000 + 122500 - 68750, 'lint + seed - ginning');
  const w = rows.find((r) => r.commodity.id === 'w');
  assert.equal(w.cotton, null);
  assert.equal(w.totalValue, 300 * 400);
});

check('a contract does not change the seed or the ginning: only the lint moves to the contract price', () => {
  const sale = { id: 's1', commodityId: 'cot', tons: 500, price: 650 };
  const cot = position([cotCom], [cotField], [sale], []).find((r) => r.commodity.id === 'cot');
  assert.equal(cot.soldValue, 500 * 650);
  assert.equal(cot.totalValue, 500 * 650 + 500 * 600 + 122500 - 68750);
  const withGin = position([cotCom], [cotField], [{ ...sale }], [{ ...ranMove, gin: { ...ranMove.gin, paidBy: 'buyer' }, tos: [{ type: 'sale', id: 's1', tons: 397.678 }] }]).find((r) => r.commodity.id === 'cot');
  assert.ok(Math.abs(withGin.cotton.ginningCost - (27340.40 + 602.322 * 68.75)) < 0.1, 'the gin counts even when the buyer pays it');
});

check('a lighter crop has less seed and ginning with it', () => {
  const rows = position([cotCom], [cotField], [], []);
  const light = positionAtYield(rows, -10)[0];
  assert.equal(light.cotton.bales, 900);
  assert.equal(light.totalValue, 900 * 600 + 900 * 0.245 * 500 - 900 * 68.75);
  assert.equal(positionAtYield(rows, 0)[0].totalValue, rows[0].totalValue, 'at 0% it matches the Position tab');
});

check('the cotton settings go to the server and back, are only sent once set, and the sheet and the card show them', () => {
  const st = (c) => ({ currentYear: '2026', years: { 2026: { sales: [], commodities: [c], fields: [], storages: [], movements: [] } }, businessDetails: {} });
  const base = { id: 'cot', name: 'Cotton', unit: 'bale' };
  assert.ok(!('cotton' in stateToRows(st(base), 'f').commodities[0]), 'a database without the column is untouched until it is used');
  const rows = stateToRows(st({ ...base, cotton: cotCom.cotton }), 'f');
  assert.deepEqual(rows.commodities[0].cotton, cotCom.cotton && cleanCotton(cotCom.cotton));
  assert.deepEqual(rowsToState(rows).years[2026].commodities[0].cotton, cleanCotton(cotCom.cotton));
  assert.equal(stateToRows(st({ ...base, cotton: null, __hasCotton: true }), 'f').commodities[0].cotton, null, 'clearing it still reaches the server');
  const s = read('docs/js/views/settings.js');
  assert.ok(s.includes("label: 'Seed price ($/t)'") && s.includes("label: 'Seed per bale (t)'") && s.includes("label: 'Levies ($/bale)'") && s.includes('cleanCotton('));
  const p = read('docs/js/views/position.js');
  assert.ok(p.includes('Cotton (lint)') && p.includes("row('Seed'") && p.includes('Less ginning'));
  assert.ok(read('supabase/migrations/20261128000000_commodity_cotton.sql').includes('add column if not exists cotton jsonb'));
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('alter table commodities add column if not exists cotton jsonb'));
});

// The Brighann RCTI P23-131: 1,116 bales BG026511 to BG027626, 1,126.95 standard bales at $630.00, GST, then three gin invoices
// prepaid by the buyer (I051/23 $8,318.80, I052/23 $45,463.14, I053/23 $29,328.79) taken off the total due.
const rctiSale = { id: 's131', contractNo: 'P23-131', commodityId: 'cot', buyer: 'Brighann Cotton Marketing', price: 630, tons: 1126.95 };
const ginLine = (no, amount, gst) => ({ date: '2023-05-20', rego: '—', tons: null, movementId: null, rate: null, subtotal: 0, isGinPrepaid: true, ginRunId: no, description: 'Brighann Ginning Invoice ' + no, ginning: Math.round((amount - gst) * 100) / 100, levies: 0, gst, amount });
const rctiLines = [
  { date: '2023-05-10', rego: '—', tons: 729.272, movementId: 'm1', rate: 630, subtotal: 729.272 * 630, bales: 723, baleRanges: [{ from: 'BG026511', to: 'BG027233', bales: 723 }] },
  { date: '2023-05-18', rego: '—', tons: 397.678, movementId: 'm2', rate: 630, subtotal: 397.678 * 630, bales: 393, baleRanges: [{ from: 'BG027234', to: 'BG027626', bales: 393 }] },
  ginLine('I051/23', 8318.80, 0), ginLine('I052/23', 45463.14, 0), ginLine('I053/23', 29328.79, 2584.91),
];
const r2 = (n) => Math.round(n * 100) / 100;

check('the bale range joins the loads that run on from each other and counts the bales', () => {
  assert.deepEqual(mergeBaleRanges([{ from: 'BG027234', to: 'BG027626', bales: 393 }, { from: 'BG026511', to: 'BG027233', bales: 723 }]), [{ from: 'BG026511', to: 'BG027626', bales: 1116 }]);
  assert.equal(mergeBaleRanges([{ from: 'BG1', to: 'BG5', bales: 5 }, { from: 'BG9', to: 'BG10', bales: 2 }]).length, 2, 'a gap is two ranges');
});

check('gin invoices prepaid by the buyer come off the total due, GST included, after the GST on the cotton', () => {
  const totals = invoiceTotals(rctiSale, rctiLines);
  assert.equal(r2(totals.subtotalExGST), 709978.50, '1,126.95 bales at $630.00');
  assert.equal(totals.ginTotal, 83110.73, 'the three gin invoices');
  assert.equal(r2(totals.gst), 70997.85, 'GST on the cotton only');
  assert.equal(r2(totals.totalPayable), 697865.62, 'the RCTI total due');
});

check('the invoice reads like the RCTI: bale range, price per bale, GST, total due including tax, gin prepaid, total due', () => {
  const t = invoiceTotals(rctiSale, rctiLines);
  const inv = { lines: rctiLines, subtotalExGST: r2(t.subtotalExGST), gst: r2(t.gst), levies: 0, freightTotal: 0, totalPayable: r2(t.totalPayable) };
  const m = cottonInvoiceModel(inv);
  assert.deepEqual(m.ranges, [{ from: 'BG026511', to: 'BG027626', bales: 1116 }]);
  assert.equal(m.physicalBales, 1116);
  assert.equal(m.rows.length, 1, 'one price, one row');
  assert.equal(m.stdBales, 1126.95);
  assert.equal(m.rows[0].rate, 630);
  assert.equal(m.valueNett, 709978.50);
  assert.equal(m.gst, 70997.85);
  assert.equal(m.dueIncludingTax, 780976.35);
  assert.deepEqual(m.gin.map((g) => g.amount), [8318.80, 45463.14, 29328.79]);
  assert.equal(m.ginTotal, 83110.73);
  assert.equal(m.totalDue, 697865.62);
});

check('premiums and discounts show apart from the gross and count in the value nett', () => {
  const lines = [...rctiLines, { date: '2023-05-27', rego: 'Colour premium', description: 'Colour premium', tons: null, movementId: null, rate: null, subtotal: -1000, isCustom: true }];
  const t = invoiceTotals(rctiSale, lines);
  const m = cottonInvoiceModel({ lines, subtotalExGST: r2(t.subtotalExGST), gst: t.gst, levies: 0, freightTotal: 0, totalPayable: t.totalPayable });
  assert.equal(m.premiumTotal, -1000);
  assert.equal(m.gross, 709978.50);
  assert.equal(m.valueNett, 708978.50);
});

check('a run delivered to a contract puts its bale numbers on the invoice line, and a buyer-paid gin invoice is a prepayment with GST', () => {
  const g = { ...run, voluntaryLevy: 1.5, paidBy: 'buyer', baleFrom: 'BG027234', baleTo: 'BG027626', allocations: [lot('sale:s1', 'BG027234', 'BG027400'), lot('sale:s2', 'BG027401', 'BG027626')] };
  const lots = allocateLint(g);
  const mv = { id: 'm1', date: '2026-05-18', commodityId: 'cot', tons: 397.678, froms: [], tos: lots.map((a) => ({ type: 'sale', id: a.to.slice(5), tons: Math.round(a.std * 1000) / 1000 })), gin: g };
  assert.deepEqual(lotsForSale(mv, 's1').map((a) => a.bales), [167]);
  const line = invoiceLineItems({ id: 's1', price: 600 }, [mv])[0];
  assert.equal(line.bales, 167);
  assert.deepEqual(line.baleRanges, [{ from: 'BG027234', to: 'BG027400', bales: 167 }]);
  const p = ginPrepaid({ id: 's1' }, [mv]);
  assert.equal(p.length, 1);
  assert.equal(p[0].invoiceNo, 'I053/23');
  const whole = { ...mv, tos: [{ type: 'sale', id: 'x', tons: 397.678 }], gin: { ...g, allocations: [lot('sale:x', 'BG027234', 'BG027626')] } };
  assert.equal(ginPrepaid({ id: 'x' }, [whole])[0].total, 29925.31, 'the whole invoice, GST on the ginning only');
  assert.equal(ginPrepaid({ id: 'x' }, [whole])[0].gst, 2584.91);
  assert.equal(ginDeduction({ id: 'x' }, [whole]).totalInclGst, 29925.31);
  assert.equal(ginPrepaid({ id: 's1' }, [{ ...mv, gin: { ...g, paidBy: 'us' } }]).length, 0, 'a gin invoice we pay is a bill');
});

check('the Xero file takes each gin prepayment off as the gin charged it: ginning with GST, levies without', () => {
  const t = invoiceTotals(rctiSale, rctiLines);
  const inv = { id: 'i1', saleId: 's131', invoiceNo: 7, issueDate: '2023-05-27', dueDate: '2023-06-27', lines: rctiLines, subtotalExGST: t.subtotalExGST, gst: t.gst, levies: 0, freightTotal: 0, totalPayable: t.totalPayable };
  const { rows } = xeroInvoices({ invoices: [inv], sales: [rctiSale], commodities: [{ id: 'cot', name: 'Cotton' }] });
  const gin = rows.filter((r) => /prepaid by buyer/.test(r['*Description']));
  assert.equal(gin.length, 3, 'one ginning line each; none of these has levies');
  assert.ok(gin.every((r) => r['*UnitAmount'] < 0));
});

check('the builder adds a prepaid gin line for each selected run, the document is the cotton layout, and the total has the gin taken off', () => {
  const v = read('docs/js/views/invoice.js');
  assert.ok(v.includes('ginPrepaid(sale, selectedMovements)') && v.includes('isGinPrepaid: true'));
  assert.ok(v.includes("commodity?.unit === 'bale') return cottonInvoiceDocHTML"));
  assert.ok(v.includes('Ginning invoices prepaid') && v.includes('Total gin prepayments on this invoice') && v.includes('Total amount due including tax') && v.includes('Bale range:'));
  assert.ok(v.includes('- ginTotal'));
});

check('the Position card counts cotton in bales, not tonnes', () => {
  const p = read('docs/js/views/position.js');
  assert.ok(p.includes("const bales = r.commodity.unit === 'bale'") && p.includes("'bales' : 't'}/ha"));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
