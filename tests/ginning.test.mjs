// Run with:
//   node tests/ginning.test.mjs
//
// A cotton ginning run: modules in, lint and seed out, priced on the 227 kg standard bale. The figures are the real gin invoice
// I053/23 (90,273 kg of lint, 393 bales pressed): $65.00 a bale to gin, $2.25 research levy, GST on the ginning only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STD_BALE_KG, cleanGin, hasGin, stdBales, turnoutPct, seedTonnes, seedKgPerBale, ginInvoice, describeGin, ginDeduction, parseBale, baleRangeCount, cleanAllocations, allocateLint, allocationProblems, cleanCotton, hasCotton, cottonComponents, cottonRunTotals, SEED_FACTOR_DEFAULT, ginPrepaid, lotsForSale, padOffBy, cleanModules, hasModules, moduleLegs, shareLoad, estimateBales, describeModules, DEFAULT_TURNOUT } from '../docs/js/ginning.js';
import { avgModuleKg } from '../docs/js/modulespicked.js';
import { modulesReport, ginnedByField } from '../docs/js/modulesreport.js';
import { modulesPdf } from '../docs/js/modulespdf.js';
import { stageOf } from '../docs/js/transit.js';
import { cleanPicked, pickedTotals, moduleEstimate, describeEstimate } from '../docs/js/modulespicked.js';
import { saleEconomics, position, positionAtYield, invoiceLineItems, invoiceTotals, storageLedgerStock, fieldTons } from '../docs/js/derived.js';
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
  assert.ok(g.includes('if (inv.bales > 0) {') && g.includes("payer: g.paidBy === 'buyer' ? 'buyer' : null"), 'every run becomes a bill; one the lint buyer pays is marked so, and is paid when their payment is');
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
  assert.ok(m.includes('shown.filter((m) => !hasGin(m) && !hasModules(m))'));
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
  assert.deepEqual(cleanCotton({ seedMtm: '500', ginRate: '65' }), { seedMtm: 500, seedFactor: 0, ginRate: 65, levies: 0, turnout: 0, moduleKg: 0 });
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

check('modules: the bales they will gin to are their weight times the turnout over the standard bale', () => {
  assert.equal(DEFAULT_TURNOUT, 40);
  assert.ok(Math.abs(estimateBales(222230, 40.62) - 397.68) < 0.05, 'the 18 modules of I053/23: 40.62% of 222,230 kg is 397.7 standard bales');
  assert.equal(estimateBales(0, 40), 0);
  assert.equal(estimateBales(1000, 0), 0);
  assert.deepEqual(cleanModules({ count: '18', kg: '222230' }), { count: 18, kg: 222230, turnoutPct: 0, estBales: 0 });
  assert.equal(cleanModules(null), null);
  assert.equal(hasModules({ modules: { count: 1 } }), true);
  assert.equal(hasModules({}), false);
  assert.equal(describeModules({ count: 18, kg: 222230, estBales: 397.68 }), '18 modules, 222,230 kg, about 397.7 bales');
  assert.equal(describeModules({ count: 1 }), '1 module');
});

check('moving modules to the yard counts them in the yard and out of the paddock, then ginning takes them out of the yard', () => {
  const yard = { id: 'yard', kind: 'tally', unitLabel: 'modules', openingStock: 0 };
  const paddock = { id: 'f1', name: 'Cotton 1', areaHa: 50, commodityId: 'cot', yieldMode: 'actual' };
  const move = { id: 'mv1', date: '2026-05-10', commodityId: 'cot', tons: 397.68, froms: [{ type: 'field', id: 'f1', tons: 397.68 }], tos: [{ type: 'silo', id: 'yard', tons: 18 }], modules: { count: 18, kg: 222230, turnoutPct: 40.62, estBales: 397.68 } };
  assert.equal(storageLedgerStock(yard, [move]), 18, 'eighteen modules in the yard');
  assert.equal(fieldTons(paddock, [move]), 397.68, 'a paddock on an actual yield has produced the bales those modules will gin to');
  const ginned = { id: 'g1', date: '2026-05-18', commodityId: 'cot', tons: 397.678, froms: [{ type: 'silo', id: 'yard', tons: 18 }], tos: [], gin: run };
  assert.equal(storageLedgerStock(yard, [move, ginned]), 0, 'ginned, the yard is empty');
});

check('a module move goes to the server and back, and a movement without one sends no column', () => {
  const st = (m) => ({ currentYear: '2026', years: { 2026: { sales: [], commodities: [], fields: [], storages: [], movements: [m] } }, businessDetails: {} });
  const base = { id: 'm1', date: '2026-05-10', tons: 397.68, froms: [], tos: [] };
  const mod = cleanModules({ count: 18, kg: 222230, turnoutPct: 40.62, estBales: 397.68 });
  const rows = stateToRows(st({ ...base, modules: mod }), 'farm1');
  assert.deepEqual(rows.movements[0].modules, mod);
  assert.deepEqual(rowsToState(rows).years[2026].movements[0].modules, mod);
  assert.ok(!('modules' in stateToRows(st(base), 'farm1').movements[0]));
});

check('the sheet moves modules from a paddock to a gin yard, estimates the bales, and the list and ginning sheet know about it', () => {
  const s = read('docs/js/views/modulemove.js');
  assert.ok(s.includes("froms: legs.map((l) => ({ type: 'field', id: l.id, tons: l.bales }))") && s.includes("tos: [{ type: 'silo', id: toId, tons: count }]"));
  assert.ok(s.includes('estimateBales(getNum(root, ' + "'mm-kg')") && s.includes('DEFAULT_TURNOUT') && s.includes('modules: cleanModules('));
  const m = read('docs/js/views/movements.js');
  assert.ok(m.includes('id="move-modules"') && m.includes('openModuleMoveSheet(null)') && m.includes('if (existing && hasModules(existing)) return openModuleMoveSheet(existing);'));
  assert.ok(m.includes('describeModules(m.modules)'));
  assert.ok(read('docs/js/views/ginrun.js').includes('g-yard-note') && read('docs/js/views/ginrun.js').includes('storageLedgerStock(yard'));
  assert.ok(read('docs/js/views/settings.js').includes("label: 'Turnout (%)'"));
  assert.ok(read('docs/js/storage.js').includes('rec.__hasModules = true'));
  assert.ok(read('supabase/migrations/20261129000000_movement_modules.sql').includes('add column if not exists modules jsonb'));
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('add column if not exists modules jsonb'));
});

check('modules picked on a paddock: picked, moved to the yard and still in the field, with the bales, seed and ginning they should come to', () => {
  const field = { id: 'f1', modulesPicked: [
    { id: 'a', date: '2026-05-01', count: 10, kg: 120000, turnoutPct: 40, estBales: 211.45 },
    { id: 'b', date: '2026-05-05', count: 8, kg: 102230, turnoutPct: 40, estBales: 180.1 },
    { id: 'zero', count: 0 },
  ] };
  assert.equal(cleanPicked(field.modulesPicked).length, 2, 'an entry with no modules is not kept');
  const move = { id: 'm1', froms: [{ type: 'field', id: 'f1', tons: 211 }], tos: [{ type: 'silo', id: 'yard', tons: 10 }], modules: { count: 10, kg: 121500, turnoutPct: 40, estBales: 214 } };
  const other = { id: 'm2', froms: [{ type: 'field', id: 'f2', tons: 50 }], tos: [], modules: { count: 3, kg: 1, turnoutPct: 40, estBales: 1 } };
  const none = pickedTotals(field, []);
  assert.deepEqual([none.picked, none.moved, none.inField], [18, 0, 18]);
  const p = pickedTotals(field, [move, other]);
  assert.deepEqual([p.picked, p.moved, p.inField], [18, 10, 8], 'only the moves out of this paddock count');
  assert.ok(Math.abs(p.inFieldBales - 391.55 * 8 / 18) < 0.001 && Math.abs(p.inFieldKg - 222230 * 8 / 18) < 0.01);
  assert.equal(pickedTotals({ id: 'f1', modulesPicked: [{ count: 5 }] }, [move]).inField, 0, 'never below nothing in the field');
  const e = moduleEstimate({ seedMtm: 500, seedFactor: 0.25, ginRate: 65, levies: 3.75 }, 400);
  assert.equal(e.seedT, 100); assert.equal(e.seedValue, 50000); assert.equal(e.ginning, 27500);
  assert.equal(describeEstimate(e), 'about 400.0 bales · 100.0 t seed ($50,000) · ginning $27,500');
  assert.equal(describeEstimate(moduleEstimate(null, 100)), 'about 100.0 bales · 24.5 t seed', 'no prices set: seed at the standard factor, no dollar figures');
  assert.equal(describeEstimate(moduleEstimate(null, 0)), '');
});

check('modules picked go to the server and back, and a paddock without any sends no column', () => {
  const st = (f) => ({ currentYear: '2026', years: { 2026: { sales: [], commodities: [], storages: [], movements: [], fields: [f] } }, businessDetails: {} });
  const base = { id: 'f1', name: 'Cotton 1', areaHa: 50, commodityId: null, yieldTHa: 0, yieldMode: 'estimate' };
  const picked = [{ id: 'a', date: '2026-05-01', count: 10, kg: 120000, turnoutPct: 40, estBales: 211.45 }];
  const rows = stateToRows(st({ ...base, modulesPicked: picked }), 'farm1');
  assert.deepEqual(rows.fields[0].modules_picked, picked);
  assert.deepEqual(rowsToState(rows).years[2026].fields[0].modulesPicked, picked);
  assert.ok(!('modules_picked' in stateToRows(st(base), 'farm1').fields[0]));
  const cleared = stateToRows(st({ ...base, modulesPicked: [], __hasModulesPicked: true }), 'farm1').fields[0];
  assert.deepEqual(cleared.modules_picked, [], 'deleting the last entry still reaches the server');
});

check('the paddock sheet logs modules picked, shows what is in the field, and the move sheet says so too', () => {
  const v = read('docs/js/views/modulespicked.js');
  assert.ok(v.includes("db.upsertField({ id: f.id, modulesPicked: cleanPicked(list) })") && v.includes('estimateBales(getNum(root, ' + "'mp-kg')") && v.includes('describeEstimate(moduleEstimate('));
  const p = read('docs/js/views/production.js');
  assert.ok(p.includes('id="log-picked"') && p.includes('openModulesPickedSheet(existing.id') && p.includes('pickedTotals(existing, movements)') && p.includes('in field'));
  const mv = read('docs/js/views/modulemove.js');
  assert.ok(mv.includes('pickedTotals(f,') && mv.includes('are still in'));
  assert.ok(read('docs/js/storage.js').includes('__hasModulesPicked = true'));
  assert.ok(read('supabase/migrations/20261130000000_field_modules_picked.sql').includes('add column if not exists modules_picked jsonb'));
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('add column if not exists modules_picked jsonb'));
  assert.ok(read('docs/js/views/movements.js').includes("commodities.some((c) => c.unit === 'bale')"), 'the module buttons show for a farm with cotton, even before the gin yard is set up');
});

check('the Position shows income per hectare and gross margin per hectare, for each commodity and for the farm', () => {
  const p = read('docs/js/views/position.js');
  assert.ok(p.includes('money(r.totalValue / r.area, 0)') && p.includes('money(r.grossMargin / r.area, 0)'));
  assert.ok(p.includes('money(totals.totalValue / totals.area, 0)') && p.includes('money(totals.grossMargin / totals.area, 0)'));
  assert.ok(p.includes('r.area > 0 ?') && p.includes('totals.area > 0 ?'), 'nothing is divided by a zero area');
});

check('a truck of modules is an estimate until the gin weighs it: the driver gives the number, the weight is estimated from the paddock, the weighbridge weight makes it final', () => {
  const yard = { id: 'yard', kind: 'tally', unitLabel: 'modules' };
  const load = (extra) => ({ id: 'm', froms: [{ type: 'field', id: 'f1', tons: 200 }], tos: [{ type: 'silo', id: 'yard', tons: 10 }], modules: { count: 10, kg: 123460, turnoutPct: 40, estBales: 217.5 }, ...extra });
  assert.equal(stageOf(load({ weightStatus: 'estimate' }), [yard]), 'weight', 'waiting for the weighbridge weight, not for a quality');
  assert.equal(stageOf(load({ weightStatus: 'final' }), [yard]), null);
  const s = read('docs/js/views/modulemove.js');
  assert.ok(s.includes("weightStatus: kgTyped ? 'final' : 'estimate'") && s.includes('avgModuleKg(f, commodities.find') && s.includes('Math.round(estKg)'));
  assert.ok(s.includes("id: 'mm-truck'") && s.includes("id: 'mm-driver'") && s.includes('truckRego:') && s.includes('driver:'));
  assert.ok(read('docs/js/views/movements.js').includes("(weight estimated)"));
});

check('the Modules report: each paddock picked, in the field, moved to the gin, estimated weight and bales; the gin yard; loads waiting for a weight', () => {
  const fields = [
    { id: 'f1', name: 'Cotton 1', modulesPicked: [{ id: 'a', date: '2026-05-01', count: 18, kg: 222230, turnoutPct: 40, estBales: 391.6 }] },
    { id: 'f2', name: 'Cotton 2', modulesPicked: [{ id: 'b', date: '2026-05-02', count: 6, kg: 74000, turnoutPct: 40, estBales: 130.4 }] },
    { id: 'f3', name: 'Wheat 1' },
  ];
  const yard = { id: 'yard', kind: 'tally', unitLabel: 'modules', openingStock: 0 };
  const leg = (fid, n, status) => ({ id: 'm' + fid + n, weightStatus: status, froms: [{ type: 'field', id: fid, tons: 100 }], tos: [{ type: 'silo', id: 'yard', tons: n }], modules: { count: n, kg: 1, turnoutPct: 40, estBales: 1 } });
  const ginned = { id: 'g1', gin: { modules: 4, lintKg: 90000 }, froms: [{ type: 'silo', id: 'yard', tons: 4 }], tos: [] };
  const r = modulesReport({ fields, movements: [leg('f1', 10, 'final'), leg('f1', 2, 'estimate'), ginned], storages: [yard] });
  assert.deepEqual(r.rows.map((x) => [x.field.name, x.picked, x.inField, x.moved]), [['Cotton 1', 18, 6, 12], ['Cotton 2', 6, 6, 0]], 'only paddocks with modules, by name');
  assert.deepEqual([r.totals.picked, r.totals.inField, r.totals.moved], [24, 12, 12]);
  assert.ok(Math.abs(r.totals.kg - (2 + 222230 * 6 / 18 + 74000)) < 0.001 && Math.abs(r.totals.estBales - (2 + 222230 * 6 / 18 + 74000) * 0.4 / 227) < 0.001, 'bales follow the whole weight of modules picked, at the turnout');
  assert.deepEqual([r.yards[0].inYard, r.yards[0].ginned], [8, 4], '12 carted in, 4 ginned out');
  assert.deepEqual([r.pending.loads, r.pending.modules], [1, 2], 'one load still on an estimated weight');
  assert.equal(modulesReport({ fields: [{ id: 'x', name: 'Wheat' }], movements: [], storages: [] }).rows.length, 0);
  const bytes = modulesPdf({ report: r, business: 'Test Farm', season: '2026', today: '18-11-2026' });
  assert.ok(bytes.length > 500 && String.fromCharCode(...bytes.slice(0, 4)) === '%PDF');
  assert.ok(modulesPdf({ report: modulesReport({}) }).length > 500, 'an empty report still makes a page');
  const v = read('docs/js/views/reports.js');
  assert.ok(v.includes('data-view="modules"') && v.includes("view === 'modules'") && v.includes('modulesReport({ fields, movements, storages, commodities })') && v.includes('id="modules-pdf"'));
});

check('a farm with no gin yard can make one in a tap, from the move sheet or the ginning sheet', () => {
  const m = read('docs/js/views/modulemove.js');
  assert.ok(m.includes('export function offerGinYard') && m.includes("kind: 'tally', unitLabel: 'modules'") && m.includes('Create gin yard') && m.includes('id: ' + "'mk-name'") && m.includes('+ Add another gin yard'));
  assert.ok(m.includes('offerGinYard(root,') && read('docs/js/views/ginrun.js').includes('offerGinYard(root,'));
});

check('already ginned by paddock: modules, bales, average module weight and turnout, taking the yard first in first ginned', () => {
  const fields = [{ id: 'f1', name: 'Cotton 1' }, { id: 'f2', name: 'Cotton 2' }];
  const load = (id, fid, date, n, kg) => ({ id, date, froms: [{ type: 'field', id: fid, tons: 1 }], tos: [{ type: 'silo', id: 'yard', tons: n }], modules: { count: n, kg, turnoutPct: 40, estBales: 1 } });
  // 10 modules from Cotton 1 (120,000 kg), then 10 from Cotton 2 (130,000 kg)
  const movements = [load('l1', 'f1', '2026-05-01', 10, 120000), load('l2', 'f2', '2026-05-02', 10, 130000),
    { id: 'g1', date: '2026-05-10', froms: [{ type: 'silo', id: 'yard', tons: 14 }], tos: [], gin: { modules: 14, moduleKg: 170000, lintKg: 68000, stdBaleKg: 227 } }];
  const r = ginnedByField({ fields, movements });
  const [a, b] = r.rows;
  assert.equal(a.field.name, 'Cotton 1'); assert.equal(a.modules, 10);
  assert.equal(b.field.name, 'Cotton 2'); assert.equal(b.modules, 4, 'the other four came from the next paddock to arrive');
  // the run's 170,000 kg and 68,000 kg lint are shared by the weight of the modules taken: 120,000 and 52,000 kg
  const shareA = 120000 / 172000;
  assert.ok(Math.abs(a.kg - 170000 * shareA) < 0.01 && Math.abs(b.kg - 170000 * (1 - shareA)) < 0.01);
  assert.ok(Math.abs(r.totals.turnoutPct - 40) < 1e-9 && Math.abs(r.totals.avgKg - 170000 / 14) < 1e-9);
  assert.ok(Math.abs(r.totals.bales - 68000 / 227) < 1e-9);
  assert.ok(Math.abs(a.turnoutPct - 40) < 1e-9, 'one run, one turnout');
  // ginned beyond what was carted in is not lost, and no run means no rows
  const over = ginnedByField({ fields, movements: [load('l1', 'f1', '2026-05-01', 2, 24000), { id: 'g', date: '2026-05-10', froms: [{ type: 'silo', id: 'yard', tons: 5 }], tos: [], gin: { modules: 5, moduleKg: 60000, lintKg: 24000 } }] });
  assert.deepEqual(over.rows.map((x) => [x.field ? x.field.name : null, x.modules]), [['Cotton 1', 2], [null, 3]]);
  assert.equal(ginnedByField({ fields, movements: [load('l1', 'f1', '2026-05-01', 2, 24000)] }).rows.length, 0);
  assert.equal(modulesReport({ fields, movements, storages: [] }).ginned.rows.length, 2);
  assert.ok(read('docs/js/views/reports.js').includes('Grower position') && read('docs/js/modulespdf.js').includes('Grower position'));
});

check('the Modules report weight is the estimate until a load is weighed at the gin yard, then the weighbridge weight', () => {
  const fields = [{ id: 'f1', name: 'Cotton 1', modulesPicked: [{ id: 'a', count: 10, kg: 120000, turnoutPct: 40, estBales: 211.45 }] }];
  const load = (id, n, kg, bales, status) => ({ id, weightStatus: status, froms: [{ type: 'field', id: 'f1', tons: 1 }], tos: [{ type: 'silo', id: 'yard', tons: n }], modules: { count: n, kg, turnoutPct: 40, estBales: bales } });
  const none = modulesReport({ fields, movements: [], storages: [] }).rows[0];
  assert.equal(none.kg, 120000); assert.equal(none.weighedPct, 0, 'nothing moved: all estimate');
  // 4 modules carted at an estimated 48,000 kg, 3 more weighed at 38,100 kg (the estimate would have been 36,000)
  const mid = modulesReport({ fields, movements: [load('l1', 4, 48000, 84.6, 'estimate'), load('l2', 3, 38100, 67.1, 'final')], storages: [] });
  const row = mid.rows[0];
  assert.equal(row.inField, 3); assert.equal(row.moved, 7);
  assert.equal(row.kg, 48000 + 38100 + 3 * 12000, 'estimated load, weighed load and the three modules still in the field');
  assert.equal(row.weighedKg, 38100);
  assert.ok(Math.abs(row.weighedPct - 38100 / 122100) < 1e-9);
  assert.ok(Math.abs(row.estBales - 122100 * 0.4 / 227) < 1e-9, 'expected bales are the paddock\'s whole weight of modules at its turnout');
  // once every load is weighed the weight is all weighbridge weight
  const done = modulesReport({ fields, movements: [load('l1', 4, 49000, 86, 'final'), load('l2', 6, 74000, 130, 'final')], storages: [] }).rows[0];
  assert.equal(done.kg, 123000); assert.equal(done.weighedPct, 1); assert.equal(done.inField, 0);
  assert.equal(done.avgKg, 12300, '123,000 kg over the 10 modules');
  assert.ok(Math.abs(row.avgKg - 122100 / 10) < 1e-9, 'weight over the modules it covers: 4 estimated, 3 weighed, 3 in the field');
  assert.ok(Math.abs(mid.totals.avgKg - 12210) < 1e-9);
  assert.ok(read('docs/js/views/reports.js').includes('Weight kg') && !read('docs/js/views/reports.js').includes('<th>Est t</th>'));
});

check('the average module weight is a cotton setting that every paddock starts from, until modules are picked on it', () => {
  assert.equal(cleanCotton({ moduleKg: '12000' }).moduleKg, 12000);
  assert.equal(hasCotton({ moduleKg: 12000 }), true);
  const com = { cotton: { moduleKg: 12000 } };
  assert.equal(avgModuleKg({ id: 'f1' }, com), 12000, 'a paddock with nothing picked starts from the setting');
  assert.equal(avgModuleKg({ id: 'f1', modulesPicked: [{ count: 10, kg: 125000 }] }, com), 12500, 'what was picked on the paddock wins');
  assert.equal(avgModuleKg({ id: 'f1' }, { cotton: {} }), 0);
  const s = read('docs/js/views/settings.js');
  assert.ok(s.includes("label: 'Module weight (kg)'") && s.includes('moduleKg: getNum(root, ' + "'ginModuleKg')"));
  const p = read('docs/js/views/modulespicked.js');
  assert.ok(p.includes('moduleKgDefault') && p.includes('Math.round(n * moduleKgDefault)'));
  assert.ok(read('docs/js/views/reports.js').includes('<th>Avg module kg</th>') && read('docs/js/modulespdf.js').includes("head: 'Avg module kg'"));
});

check('the cotton Position shows the seed and the ginning in dollars a bale as well', () => {
  const p = read('docs/js/views/position.js');
  assert.ok(p.includes('perBale(c.seedValue)') && p.includes('perBale(c.ginningCost)') && p.includes('/bale'));
  const c = cottonComponents({ seedMtm: 500, seedFactor: 0.25, ginRate: 65, levies: 3.75 }, 400);
  assert.equal(c.seedValue / c.bales, 125, 'seed is $125 a bale: 0.25 t a bale at $500 a tonne');
  assert.equal(c.ginningCost / c.bales, 68.75, 'ginning and levies come to $68.75 a bale');
});

check('the commodity average module weight stands in for any modules with no weight, and expected bales come from all the modules picked', () => {
  const commodities = [{ id: 'c1', cotton: { moduleKg: 2400, turnout: 40 } }];
  // 20 modules logged with no weight (the setting was not there yet), 8 carted on loads with no weight either
  const fields = [{ id: 'f1', name: 'Cotton 1', commodityId: 'c1', modulesPicked: [{ id: 'a', count: 20, kg: 0, turnoutPct: 0, estBales: 0 }] }];
  const load = { id: 'l1', weightStatus: 'estimate', froms: [{ type: 'field', id: 'f1', tons: 1 }], tos: [{ type: 'silo', id: 'yard', tons: 8 }], modules: { count: 8, kg: 0, turnoutPct: 40, estBales: 0 } };
  const row = modulesReport({ fields, movements: [load], storages: [], commodities }).rows[0];
  assert.equal(row.avgKg, 2400, 'the average is the commodity setting, not a low figure from modules counted as weighing nothing');
  assert.equal(row.kg, 20 * 2400);
  assert.ok(Math.abs(row.estBales - 20 * 2400 * 0.4 / 227) < 1e-9, 'expected bales from all 20 modules picked');
  assert.equal(row.weighedPct, 0);
  // picked at their own weight, the paddock's average is theirs; moved weighed loads use the weighbridge
  const own = { id: 'f1', name: 'Cotton 1', commodityId: 'c1', modulesPicked: [{ id: 'a', count: 10, kg: 26000, turnoutPct: 42, estBales: 0 }] };
  const weighed = { ...load, weightStatus: 'final', modules: { count: 4, kg: 10400, turnoutPct: 42, estBales: 0 } };
  const r2 = modulesReport({ fields: [own], movements: [weighed], storages: [], commodities }).rows[0];
  assert.equal(r2.kg, 10400 + 6 * 2600); assert.equal(r2.avgKg, 2600); assert.equal(r2.turnoutPct, 42);
  assert.ok(Math.abs(r2.estBales - 26000 * 0.42 / 227) < 1e-9);
  assert.equal(avgModuleKg({ id: 'f1', modulesPicked: [{ count: 10, kg: 0 }] }, commodities[0]), 2400, 'a paddock with modules logged at no weight starts from the setting');
  assert.ok(read('docs/js/views/reports.js').includes('modulesReport({ fields, movements, storages, commodities })'));
});

check('each lot of lint goes to a contract or a storage, with its location, bale numbers and its own weight', () => {
  const g = { ...split, allocations: [
    { to: 'sale:s1', baleFrom: 'BG027234', baleTo: 'BG027400', kg: 38500 },
    { to: 'silo:st1', location: ' Bay 3 ', baleFrom: 'BG027401', baleTo: 'BG027626', kg: split.lintKg - 38500 },
  ] };
  const c = cleanGin(g).allocations;
  assert.equal(c[1].location, 'Bay 3'); assert.equal(c[0].kg, 38500);
  const a = allocateLint(g);
  assert.equal(a[0].kg, 38500); assert.equal(a[0].weighed, true);
  assert.ok(Math.abs(a[0].std - 38500 / 227) < 1e-9, 'standard bales are the lot weight over 227');
  assert.equal(a[1].location, 'Bay 3');
  assert.deepEqual(allocationProblems(g), []);
  const short = allocationProblems({ ...g, allocations: [{ ...g.allocations[0] }, { ...g.allocations[1], kg: 1000 }] }).join(' ');
  assert.match(short, /kg of the .* kg of lint is allocated/);
  // no weights typed: the run's lint is shared by bales, as before
  const shared = allocateLint({ ...split, allocations: [lot('sale:s1', 'BG027234', 'BG027400'), lot('silo:st1', 'BG027401', 'BG027626')] });
  assert.equal(shared[0].weighed, false);
  assert.ok(Math.abs(shared[0].kg + shared[1].kg - split.lintKg) < 1e-6);
  assert.equal(cleanAllocations([{ to: '', kg: 500 }]).length, 1, 'a lot with only a weight is kept');
});

check('cotton is due off the gin pad seven days after ginning', () => {
  assert.equal(padOffBy('2026-05-18'), '2026-05-25');
  assert.equal(padOffBy('2026-05-28'), '2026-06-04', 'across a month end');
  assert.equal(padOffBy('2026-12-28'), '2027-01-04', 'across a year end');
  assert.equal(padOffBy(''), '');
  const g = read('docs/js/views/ginrun.js');
  assert.ok(g.includes('class="al-kind"') && g.includes('class="al-loc"') && g.includes('class="al-kg"') && g.includes('To a contract') && g.includes('To a storage') && g.includes('off the gin pad by'));
  assert.ok(read('docs/js/views/movements.js').includes('padOffBy(m.date)'));
});

check('classing premiums and discounts go on a cotton invoice by total or by dollars a bale, and show on it', () => {
  const inv = { subtotalExGST: 100000 + 1800 - 450, gst: 0, levies: 0, freightTotal: 0, lines: [
    { movementId: 'm1', tons: 100, rate: 1000, subtotal: 100000 },
    { isCustom: true, description: 'BG027234 to BG027400 classing', perBale: 18, bales: 100, subtotal: 1800 },
    { isCustom: true, description: 'Short staple', subtotal: -450 },
  ] };
  const m = cottonInvoiceModel(inv);
  assert.equal(m.premiums.length, 2);
  assert.equal(m.premiumTotal, 1350);
  const v = read('docs/js/views/invoice.js');
  assert.ok(v.includes("isCotton ? 'Premiums and discounts'") && v.includes('class="ci-perbale"') && v.includes('class="ci-bales"') && v.includes("'ci-refresh'"));
  assert.ok(v.includes('perBale: item.perBale') && v.includes('a bale</small>'), 'the dollars a bale is kept on the line and shown on the invoice');
});

check('premiums and discounts entered in US$ are converted at the rate, as on the merchant RCTI', () => {
  // C2610: US$ -1,820.67 at 0.6609 is A$ -2,754.83; nett 168,598.57; GST 16,859.86; due 185,458.43; less gin 50,841.04
  const aud = Math.round((-1820.67 / 0.6609) * 100) / 100;
  assert.equal(aud, -2754.83);
  const inv = { subtotalExGST: 171353.40 + aud, gst: 16859.86, levies: 0, freightTotal: 0, lines: [
    { movementId: 'm1', tons: 300.62, rate: 570, subtotal: 171353.40 },
    { isCustom: true, description: 'Classing', subtotal: aud, foreign: { usd: -1820.67, rate: 0.6609 } },
    { isGinPrepaid: true, description: 'NORTH WEST GINNING Ginning Invoice I016/26', amount: 50841.04 },
  ] };
  const m = cottonInvoiceModel(inv);
  assert.equal(m.usdTotal, -1820.67); assert.equal(m.fxRate, 0.6609);
  assert.equal(m.valueNett, 168598.57); assert.equal(m.dueIncludingTax, 185458.43); assert.equal(m.totalDue, 134617.39);
  const v = read('docs/js/views/invoice.js');
  assert.ok(v.includes('id="ci-ccy"') && v.includes('id="ci-fx"') && v.includes('foreign: { usd: item.amount, rate: cur.rate }') && v.includes('at an exchange rate of'));
});

console.log('\n=== the grower position, as the gin prints it, and the cotton on hand ===');
const demoSeed = JSON.parse(readFileSync(new URL('../docs/demo/seed.json', import.meta.url), 'utf8'));
const demoYear = demoSeed.years[demoSeed.currentYear];
const demoReport = modulesReport({ fields: demoYear.fields, movements: demoYear.movements, storages: demoYear.storages, commodities: demoYear.commodities });
check('a row to a paddock: variety, hectares, picked, loads, to the gin, ginned, bales, turnout and bales a hectare', () => {
  const north = demoReport.grower.find((r) => r.field.name === 'Cotton North');
  assert.equal(north.variety, 'Sicot 746B3F');
  assert.deepEqual([north.ha, north.picked, north.loads, north.moved, north.ginnedModules, north.inYard], [150, 360, 3, 300, 300, 0]);
  assert.ok(north.bales > 1300 && north.turnoutPct > 40);
  assert.ok(Math.abs(north.yieldBalesHa - north.bales / 150) < 1e-9, 'yield is ginned standard bales over the hectares');
  const south = demoReport.grower.find((r) => r.field.name === 'Cotton South');
  assert.deepEqual([south.picked, south.loads, south.moved, south.ginnedModules, south.inYard, south.bales, south.yieldBalesHa], [150, 1, 40, 0, 40, 0, 0], 'picked, carted, not yet ginned: no yield');
});
check('the totals add the paddocks, and the yield is over the hectares that have been ginned', () => {
  const t = demoReport.growerTotals;
  assert.deepEqual([t.ha, t.picked, t.loads, t.moved, t.ginnedModules], [268, 510, 4, 340, 300]);
  assert.ok(Math.abs(t.yieldBalesHa - t.bales / 150) < 1e-9);
});
check('cotton on hand: in the field, in the gin yard and in the bale shed, each module in one place', () => {
  const h = demoReport.onHand;
  assert.equal(h.inField, 170, '510 picked less the 340 carted');
  assert.equal(h.inYard, 40, '340 carted less the 300 ginned');
  assert.equal(h.inField + h.inYard + 300, 510, 'every module picked is in the field, in the yard or ginned');
  assert.ok(h.inShed > 300 && h.inFieldBales > 0 && h.yardBales > 0);
  assert.ok(Math.abs(h.total - (h.inFieldBales + h.yardBales + h.inShed)) < 1e-9);
});
check('the report screen, the PDF and the Storage tab carry them', () => {
  assert.ok(read('docs/js/views/reports.js').includes('Grower position') && read('docs/js/modulespdf.js').includes('GROWER_COLUMNS_2'));
  assert.ok(read('docs/js/views/storage.js').includes('function cottonOnHandCard') && read('docs/js/views/storage.js').includes('Cotton on hand'));
  const pdf = Buffer.from(modulesPdf({ report: demoReport, business: 'Sample', season: 'Sample 2026', today: '18-11-2026' })).toString('latin1');
  assert.ok(pdf.includes('Grower position') && pdf.includes('Sicot 746B3F'));
});

console.log('\n=== a load of modules from more than one paddock ===');
const mfFields = [
  { id: 'fa', name: 'A', commodityId: 'c', areaHa: 100, modulesPicked: [{ id: 'p1', date: '2026-04-01', count: 100, kg: 240000, turnoutPct: 43, estBales: 454 }] },
  { id: 'fb', name: 'B', commodityId: 'c', areaHa: 50, modulesPicked: [{ id: 'p2', date: '2026-04-02', count: 60, kg: 120000, turnoutPct: 43, estBales: 227 }] },
];
const mfLoad = {
  id: 'ml', date: '2026-04-10', status: 'closed', weightStatus: 'final', tons: 200, commodityId: 'c',
  froms: [{ type: 'field', id: 'fa', tons: 140 }, { type: 'field', id: 'fb', tons: 60 }], tos: [{ type: 'silo', id: 'yard', tons: 100 }],
  modules: { count: 100, kg: 240000, turnoutPct: 43, estBales: 200, fields: [{ id: 'fa', count: 60, kg: 150000, bales: 140 }, { id: 'fb', count: 40, kg: 90000, bales: 60 }] },
};
check('a weight typed for the whole load is shared by what each paddock\'s modules weigh, and adds back to the load', () => {
  const avg = (id) => ({ fa: 2400, fb: 2000 }[id] || 0);
  const legs = shareLoad([{ id: 'fa', count: 60 }, { id: 'fb', count: 40 }, { id: 'fa', count: 0 }].filter((r) => r.count > 0), 224000, 440, avg);
  assert.equal(legs.length, 2);
  assert.equal(legs.reduce((s, l) => s + l.count, 0), 100);
  assert.ok(Math.abs(legs.reduce((s, l) => s + l.kg, 0) - 224000) <= 1);
  assert.ok(Math.abs(legs.reduce((s, l) => s + l.bales, 0) - 440) < 0.01);
  assert.ok(legs[0].kg > legs[1].kg, 'the paddock with the heavier modules takes the larger share');
  assert.equal(shareLoad([{ id: 'fa', count: 30 }, { id: 'fa', count: 20 }], 100000, 200, avg).length, 1, 'the same paddock twice is one leg');
  assert.deepEqual(shareLoad([{ id: 'fa', count: 3 }, { id: 'fb', count: 1 }], 400, 4, () => 0).map((l) => l.kg), [300, 100], 'with no module weights it goes by the number of modules');
});
check('a load says which paddocks it came from; a load from one paddock is the whole load', () => {
  assert.deepEqual(moduleLegs(mfLoad).map((l) => [l.fieldId, l.count]), [['fa', 60], ['fb', 40]]);
  const single = { modules: { count: 30, kg: 72000, estBales: 140 }, froms: [{ type: 'field', id: 'fa', tons: 140 }] };
  assert.deepEqual(moduleLegs(single), [{ fieldId: 'fa', count: 30, kg: 72000, bales: 140 }]);
  assert.deepEqual(moduleLegs({}), []);
  assert.equal(cleanModules({ count: 5, fields: [{ id: 'fa', count: 5 }] }).fields, undefined, 'one paddock needs no list');
  assert.equal(cleanModules(mfLoad.modules).fields.length, 2);
});
check('each paddock\'s moved and in-field count follow its own modules', () => {
  const a = pickedTotals(mfFields[0], [mfLoad]);
  const b = pickedTotals(mfFields[1], [mfLoad]);
  assert.deepEqual([a.picked, a.moved, a.inField], [100, 60, 40]);
  assert.deepEqual([b.picked, b.moved, b.inField], [60, 40, 20]);
});
check('the report counts the load once for each paddock, and the cotton on hand adds up', () => {
  const r = modulesReport({ fields: mfFields, movements: [mfLoad], storages: [{ id: 'yard', kind: 'tally', name: 'Yard', unitLabel: 'modules' }], commodities: [{ id: 'c', unit: 'bale', cotton: { moduleKg: 2400 } }] });
  assert.deepEqual(r.grower.map((g) => [g.field.name, g.picked, g.loads, g.moved]), [['A', 100, 1, 60], ['B', 60, 1, 40]]);
  assert.equal(r.onHand.inField, 60, '160 picked less the 100 carted');
  assert.equal(r.onHand.inYard, 100);
  assert.equal(r.pending.loads, 0);
});
check('modules leave the yard in the order they arrived, paddock by paddock, from a load of several', () => {
  const run = { id: 'g1', date: '2026-04-20', status: 'closed', commodityId: 'c', froms: [{ type: 'silo', id: 'yard', tons: 70 }], tos: [], gin: { modules: 70, moduleKg: 165000, lintKg: 70000, stdBaleKg: 227 } };
  const g = ginnedByField({ fields: mfFields, movements: [mfLoad, run] });
  const by = Object.fromEntries(g.rows.map((x) => [x.field.name, x.modules]));
  assert.deepEqual(by, { A: 60, B: 10 }, 'A arrived first: its 60, then 10 of B\'s 40');
});
check('the move sheet takes more than one paddock, as grain does, and saves each paddock\'s share', () => {
  const s = read('docs/js/views/modulemove.js');
  assert.ok(s.includes('id="mm-add"') && s.includes('+ Add another paddock') && s.includes('shareLoad(rows, totalKg, estBales, avgKgFor)'));
  assert.ok(s.includes('fields: legs.map((l) => ({ id: l.id, count: l.count, kg: l.kg, bales: l.bales }))'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
