// Run with:
//   node tests/summaries.test.mjs
//
// The by-commodity summaries on the Fert and Seed reports (screen and PDF), and what each buyer could cost the farm.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSION } from '../docs/js/version.js';
const stamp = APP_VERSION.split('.').pop();
const { ureaFigures, starterFigures, seedFigures, ureaSummary, starterSummary, seedSummary, NO_VARIETY } = await import(`../docs/js/fertfigures.js?v=${stamp}`);
const { groupFieldsByCommodity } = await import(`../docs/js/derived.js?v=${stamp}`);
const { fertPdf } = await import(`../docs/js/fertpdf.js?v=${stamp}`);
const { seedPdf } = await import(`../docs/js/seedpdf.js?v=${stamp}`);
const { buyerExposure, dueByWeek } = await import(`../docs/js/exposure.js?v=${stamp}`);
const { exposurePdf, mtmText, mtmColour, EXPOSURE_COLUMNS } = await import(`../docs/js/exposurepdf.js?v=${stamp}`);

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const text = (bytes) => Buffer.from(bytes).toString('latin1');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} is not ${b}`);

const commodities = [
  { id: 'w', name: 'Wheat', nPerTonne: 40, targetYieldTHa: 4, mtmPrice: 380 },
  { id: 'c', name: 'Canola', nPerTonne: 60, targetYieldTHa: 2, mtmPrice: 0 },
];
const fields = [
  { id: 'f1', name: 'North', areaHa: 200, commodityId: 'w', soilTestNKgHa: 46, ureaRequiredKgHa: 200, ureaAppliedKgHa: 100, starterRequiredKgHa: 50, starterAppliedKgHa: 20, seedVariety: 'Scepter', seedRateKgHa: 80 },
  { id: 'f2', name: 'South', areaHa: 100, commodityId: 'w', soilTestNKgHa: 23, ureaRequiredKgHa: 150, ureaAppliedKgHa: 0, starterRequiredKgHa: 50, starterAppliedKgHa: 0, seedVariety: ' scepter', seedRateKgHa: 80 },
  { id: 'f4', name: 'East', areaHa: 100, commodityId: 'w', soilTestNKgHa: 30, ureaRequiredKgHa: 100, ureaAppliedKgHa: 0, seedVariety: 'Lancer', seedRateKgHa: 90 },
  { id: 'f5', name: 'Spare', areaHa: 20, commodityId: 'w', seedVariety: '', seedRateKgHa: 80 },
  { id: 'f3', name: 'Back', areaHa: 50, commodityId: 'c', soilTestNKgHa: 0, ureaRequiredKgHa: 120, ureaAppliedKgHa: 120, seedVariety: 'Hyola', seedRateKgHa: 4 },
];
const groups = groupFieldsByCommodity(commodities, fields, []);
const ureaFigs = groups.map((g) => ureaFigures(g, commodities.find((c) => c.id === g.id)));
const starterFigs = groups.map((g) => starterFigures(g));
const seedFigs = groups.map((g) => seedFigures(g));

console.log('\n=== fert by commodity ===');
check('a row for each commodity (its own total) and a farm total worked from every paddock', () => {
  const u = ureaSummary(ureaFigs);
  assert.deepEqual(u.rows.map((r) => r.name).sort(), ['Canola', 'Wheat']);
  const wheat = u.rows.find((r) => r.name === 'Wheat');
  near(wheat.reqT, 200 * 200 / 1000 + 100 * 150 / 1000 + 100 * 100 / 1000);
  near(u.total.reqT, wheat.reqT + 50 * 120 / 1000);
  near(u.total.area, 200 + 100 + 100 + 20 + 50);
  near(u.total.req, (u.total.reqT * 1000) / u.total.area);   // kg/ha is tonnes over area, not an average of averages
});
check('the same for starter fertiliser', () => {
  const s = starterSummary(starterFigs);
  near(s.rows.find((r) => r.name === 'Wheat').reqT, (200 * 50 + 100 * 50) / 1000);
  near(s.total.appT, 200 * 20 / 1000);
});
check('the PDF has the all-commodities table first when asked, and not otherwise', () => {
  const data = { urea: ureaFigs, starter: starterFigs };
  assert.ok(text(fertPdf({ ...data, summary: true })).includes('all commodities'));
  assert.ok(!text(fertPdf(data)).includes('all commodities'));
  assert.ok(!text(fertPdf({ urea: ureaFigs.slice(0, 1), starter: [], summary: true })).includes('all commodities'), 'one commodity is its own summary');
});

console.log('\n=== seed by commodity and variety ===');
check('varieties are one line whatever the capitals or spacing, biggest first, with no variety last', () => {
  const wheat = seedSummary(seedFigs).find((c) => c.name === 'Wheat');
  assert.deepEqual(wheat.varieties.map((v) => v.variety), ['Scepter', 'Lancer', NO_VARIETY]);
  const scepter = wheat.varieties[0];
  assert.equal(scepter.fields, 2); assert.equal(scepter.area, 300);
  near(scepter.requiredT, 24); near(scepter.rate, 80);
});
check('a commodity total matches the commodity table, and nothing is lost between them', () => {
  for (const c of seedSummary(seedFigs)) {
    const fig = seedFigs.find((f) => f.name === c.name);
    near(c.total.requiredT, fig.total.requiredT);
    near(c.varieties.reduce((s, v) => s + v.requiredT, 0), fig.total.requiredT);
    near(c.varieties.reduce((s, v) => s + v.area, 0), fig.total.area);
  }
});
check('the seed PDF carries the commodity and variety table', () => {
  const s = text(seedPdf(seedFigs, { business: 'Test Farm', season: '2026', today: '16-11-2026', bufferPct: 5 }));
  assert.ok(s.includes('By commodity and variety') && s.includes('Scepter'));
});

console.log('\n=== what each buyer could cost ===');
const TODAY = '2026-11-16';
const sales = [
  { id: 's1', buyer: 'Riverina Grain', commodityId: 'w', tons: 500, price: 400 },
  { id: 's2', buyer: 'riverina grain ', commodityId: 'w', tons: 300, price: 350 },
  { id: 's3', buyer: 'Coastal Co', commodityId: 'w', tons: 100, price: 300 },
  { id: 's4', buyer: 'Canola Buyers', commodityId: 'c', tons: 50, price: 700 },
];
const load = (id, saleId, tons, date) => ({ id, date, tons, tos: [{ type: 'sale', id: saleId, tons }], froms: [] });
const movements = [load('m1', 's1', 200, '2026-10-20'), load('m2', 's2', 50, '2026-11-01')];
const invoices = [
  { id: 'i1', saleId: 's1', invoiceNo: 1, issueDate: '2026-10-01', dueDate: '2026-10-31', totalPayable: 1000, status: 'sent' },
  { id: 'i3', saleId: 's3', invoiceNo: 3, issueDate: '2026-09-01', dueDate: '2026-09-30', totalPayable: 99999, status: 'paid' },
];
const ex = buyerExposure(invoices, sales, movements, commodities, TODAY);
const riv = ex.buyers.find((b) => b.key === 'riverina grain');
check('the same buyer in any capitals is one, and what they owe is the unpaid invoices plus grain not yet invoiced', () => {
  assert.equal(ex.buyers.filter((b) => b.key === 'riverina grain').length, 1);
  assert.equal(riv.unpaidTotal, 1000); assert.equal(riv.overdueTotal, 1000);
  near(riv.notInvoicedValue, 200 * 400 + 50 * 350);
  near(riv.owing, 1000 + 200 * 400 + 50 * 350);
});
check('still to go is the tonnes left on open contracts at the contract price', () => {
  assert.equal(riv.contracts, 2); near(riv.dueTons, 300 + 250); near(riv.dueValue, 300 * 400 + 250 * 350);
});
check('against MTM is contract price less MTM over the tonnes left, signed', () => {
  near(riv.mtmGap, (400 - 380) * 300 + (350 - 380) * 250);
  near(ex.buyers.find((b) => b.key === 'coastal co').mtmGap, (300 - 380) * 100);
});
check('a commodity with no MTM price is counted in still to go but left out of the gap, and counted', () => {
  const can = ex.buyers.find((b) => b.key === 'canola buyers');
  near(can.dueValue, 50 * 700); assert.equal(can.mtmGap, 0); assert.equal(can.noMtm, 1);
  assert.equal(ex.total.noMtm, 1);
});
check('a buyer owing nothing but with grain to go is listed; a paid-up, filled one is not; the biggest debt is first', () => {
  assert.ok(ex.buyers.some((b) => b.key === 'coastal co' && b.owing === 0 && b.dueTons === 100));
  assert.equal(ex.buyers[0].key, 'riverina grain');
  near(ex.buyers.reduce((s, b) => s + b.share, 0), 1);
});
check('the totals add the buyers up', () => {
  near(ex.total.owing, ex.buyers.reduce((s, b) => s + b.owing, 0));
  near(ex.total.dueValue, ex.buyers.reduce((s, b) => s + b.dueValue, 0));
  near(ex.total.mtmGap, ex.buyers.reduce((s, b) => s + b.mtmGap, 0));
  assert.equal(ex.total.buyers, 3);
});

console.log('\n=== invoices due by week ===');
check('overdue first, then this week, next week, each week after, later, and no due date; empty weeks are left out', () => {
  const rows = [
    { amount: 1000, overdue: true, dueDate: '2026-10-31' },
    { amount: 200, dueDate: '2026-11-20' }, { amount: 50, dueDate: '2026-11-18' },
    { amount: 300, dueDate: '2026-11-23' },
    { amount: 400, dueDate: '2026-12-02' },
    { amount: 500, dueDate: '2027-03-01' },
    { amount: 60 },
  ];
  const w = dueByWeek(rows, '2026-11-18');           // a Wednesday: the week began Monday 16 Nov
  assert.deepEqual(w.map((x) => x.label), ['Overdue', 'This week', 'Next week', 'w/c 30 Nov', 'Later', 'No due date']);
  assert.deepEqual(w.map((x) => x.amount), [1000, 250, 300, 400, 500, 60]);
  assert.equal(w[1].count, 2);
  assert.equal(w[0].late, true); assert.equal(w[1].late, false);
});
check('the weeks add up to what is invoiced and unpaid, and each buyer has the next payment due', () => {
  assert.equal(ex.weeks.reduce((s, x) => s + x.amount, 0), ex.total.unpaidTotal);
  assert.equal(ex.total.notInvoicedValue, 200 * 400 + 50 * 350);
  const soon = buyerExposure([{ id: 'i9', saleId: 's2', invoiceNo: 9, issueDate: '2026-11-10', dueDate: '2026-11-25', totalPayable: 500, status: 'sent' }], sales, [], commodities, TODAY);
  const r = soon.buyers.find((b) => b.key === 'riverina grain');
  assert.deepEqual(r.nextDue, { date: '2026-11-25', amount: 500 });
  assert.equal(soon.buyers.find((b) => b.key === 'coastal co').nextDue, undefined);
});

console.log('\n=== exposure PDF and MTM colours ===');
check('the MTM gap is written with a minus sign when below zero, plain above, and coloured green or red', () => {
  assert.equal(mtmText(-16556.4), '-$16,556');
  assert.equal(mtmText(1632), '$1,632');
  assert.equal(mtmText(0.2), '$0');
  assert.deepEqual(mtmColour(1632), [0.18, 0.49, 0.196]);
  assert.deepEqual(mtmColour(-5), [0.72, 0.11, 0.11]);
  assert.equal(mtmColour(0), 0);
});
check('the PDF has a row for each buyer and a total, landscape, with the figures', () => {
  const s = text(exposurePdf(ex, { business: 'Test Farm', today: '16/11/2026' }));
  assert.ok(s.startsWith('%PDF-1.4') && s.includes('/MediaBox [0 0 841.89 595.28]'));
  for (const w of ['BUYER EXPOSURE', 'Test Farm', 'Riverina Grain', 'Coastal Co', 'Canola Buyers', 'Total', 'Contracts vs MTM']) assert.ok(s.includes(w), 'missing ' + w);
  assert.equal(EXPOSURE_COLUMNS.reduce((a, c) => a + c.w, 0).toFixed(2), '1.00', 'the columns fill the width');
});
check('each buyer lists its open contracts, and the PDF puts each one on its own line under the buyer', () => {
  for (const b of ex.buyers) {
    assert.equal(b.list.length, b.contracts, b.buyer + ' has a line for each contract');
    assert.equal(Math.round(b.list.reduce((s, c) => s + c.tons, 0) * 1000) / 1000, b.dueTons);
    assert.equal(Math.round(b.list.reduce((s, c) => s + c.value, 0) * 100) / 100, b.dueValue);
    assert.equal(Math.round(b.list.reduce((s, c) => s + (c.gap || 0), 0) * 100) / 100, b.mtmGap);
  }
  const lines = ex.buyers.reduce((n, b) => n + b.list.length, 0);
  assert.ok(lines >= 3);
  assert.ok(text(exposurePdf(ex)).split('/Contents').length > 1);
  const lineOf = (c) => EXPOSURE_COLUMNS.map((col) => col.line(c));
  const one = { contractNo: 'C12', commodity: 'Wheat', grade: 'APW', price: 379, mtm: 360, delivered: 120, tons: 80, value: 30320, gap: 1520 };
  assert.deepEqual(lineOf(one).slice(0, 8), ['#C12', 'Wheat APW', '$379', '$360', '120', '80', '$30,320', '$1,520'], 'a contract is one line: number, commodity, price, MTM, delivered, outstanding');
  assert.equal(EXPOSURE_COLUMNS[7].line({ ...one, mtm: 0, gap: null }), 'no MTM');
  assert.ok(ex.buyers.every((b) => b.list.every((c) => typeof c.delivered === 'number' && 'contractNo' in c)), 'every contract line carries its delivered tonnes and its number');
  assert.equal(Math.round(ex.buyers.reduce((s, b) => s + b.deliveredTons, 0) * 1000), Math.round(ex.total.deliveredTons * 1000));
});
check('a buyer whose commodity has no MTM price says so in the MTM column, and an empty list still makes a file', () => {
  assert.ok(text(exposurePdf(ex)).includes('no MTM'));
  assert.ok(text(exposurePdf({ buyers: [], total: {} })).includes('No buyer owes anything'));
});

console.log('\n=== wired ===');
check('the screens use them', () => {
  const r = read('docs/js/views/reports.js');
  assert.ok(r.includes('fertSummaryTable(ureaSummary(') && r.includes('fertSummaryTable(starterSummary(') && r.includes('seedSummaryTable(seedSummary('));
  assert.ok(r.includes('summary: groups.length > 1'), 'the fert PDF is told when to add the all-commodities tables');
  const o = read('docs/js/views/outstanding.js');
  assert.ok(o.includes('buyersHtml(buyerExposure(invoices, sales, movements, commodities, today)') && o.includes('data-statement'), 'the statement button is kept');
  assert.ok(o.includes('id="exposure-pdf"') && o.includes('exposurePdf(') && o.includes('mtmHtml(total.mtmGap)') && o.includes('mtmHtml(b.mtmGap)'));
  assert.ok(o.includes('overdue</span>') && !o.includes('<div class="l">Overdue</div>'), 'overdue sits in the Owing now box, not a box of its own');
});

console.log('');
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('all passed');
