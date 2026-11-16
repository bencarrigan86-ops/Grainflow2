// Run with:
//   node tests/positionpdf.test.mjs
//
// The Position screen as a PDF: it is a real PDF, every commodity is on it with the figures the screen shows, the
// whole-farm lines follow, and an empty farm and a loss are handled.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { positionPdf, POSITION_COLUMNS, BODY, HEAD, PAD } from '../docs/js/positionpdf.js';
import { textWidth } from '../docs/js/pdf.js';
import { positionRows, positionTotals, farmProfitLoss } from '../docs/js/derived.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

const commodities = [
  { id: 'w', name: 'Wheat', mtmPrice: 400, grossMarginCost: 100000 },
  { id: 'c', name: 'Canola', mtmPrice: 800, grossMarginCost: 50000 },
];
const fields = [
  { id: 'f1', name: 'North', areaHa: 200, commodityId: 'w', yieldTHa: 4, yieldMode: 'estimate' },
  { id: 'f2', name: 'South', areaHa: 100, commodityId: 'c', yieldTHa: 2, yieldMode: 'estimate' },
];
const sales = [{ id: 's1', commodityId: 'w', tons: 500, price: 420, freight: 0, leviesPct: 0, tonsDelivered: 0 }];
const overheads = { finance: 30000, wages: 20000 };

const build = (over = {}) => {
  const rows = positionRows(commodities, fields, sales, []);
  const totals = positionTotals(rows);
  const cost = { total: 0, brokerage: 0, freight: 0, storage: 0, other: 0, ...over.cost };
  const pl = farmProfitLoss(totals.grossMargin, over.overheads ?? overheads, totals.openingValue, cost.total);
  return { rows, totals, overheads: over.overheads ?? overheads, pl, cost };
};
const text = (bytes) => Buffer.from(bytes).toString('latin1');

check('it is a PDF, landscape A4', () => {
  const s = text(positionPdf(build(), { business: 'Test Farm', season: 'Sample 2026', today: '16/11/2026' }));
  assert.ok(s.startsWith('%PDF-1.4') && s.trimEnd().endsWith('%%EOF'));
  assert.ok(s.includes('/MediaBox [0 0 841.89 595.28]'), 'not landscape');
});

check('the title, the farm, the season and the day are on it', () => {
  const s = text(positionPdf(build(), { business: 'Test Farm', season: 'Sample 2026', today: '16/11/2026' }));
  for (const w of ['POSITION', 'Test Farm', 'Sample 2026', 'Printed 16/11/2026']) assert.ok(s.includes(`(${w}`) || s.includes(w), `missing ${w}`);
});

check('each commodity is a row, with its produced, sold and unsold tonnes and its values', () => {
  const data = build();
  const s = text(positionPdf(data));
  const wheat = data.rows.find((r) => r.commodity.name === 'Wheat');
  assert.equal(Math.round(wheat.productionTons), 800);
  for (const w of ['(Wheat)', '(Canola)', '(800 t)', '(500 t)', '(300 t)', '(200 t)', '($210,000)']) assert.ok(s.includes(w), `missing ${w}`);
});

check('the columns fit the page: their widths add up to the table width, no more', () => {
  const sum = POSITION_COLUMNS.reduce((a, c) => a + c.w, 0);
  assert.ok(Math.abs(sum - 1) < 0.0005, `columns add up to ${sum.toFixed(3)} of the width`);
});

check('every figure and heading fits its column, even on a farm forty times the size', () => {
  const rows = positionRows(commodities, fields, sales, []).map((r) => ({
    ...r, area: r.area * 40, productionTons: r.productionTons * 40, soldTons: r.soldTons * 40, unsoldTons: r.unsoldTons * 40,
    soldValue: r.soldValue * 40, unsoldValue: r.unsoldValue * 40, totalValue: r.totalValue * 40, grossMarginCost: r.grossMarginCost * 40,
    grossMargin: r.grossMargin * 40, commodity: { ...r.commodity, name: 'Chickpeas' },
  }));
  const totals = positionTotals(rows);
  const W = 841.89 - 72;
  POSITION_COLUMNS.forEach((c, i) => {
    const heading = textWidth(c.label, HEAD, true);
    const body = Math.max(...[...rows.map((r) => c.cell(r)), c.total(totals)].map((s) => textWidth(String(s), BODY, true)));
    const room = c.w * W - PAD;
    assert.ok(heading <= room + 4 && body <= room, `${c.label}: needs ${Math.max(heading, body).toFixed(1)} of ${room.toFixed(1)}`);
  });
});

check('headings and figures are centred in their columns, the commodity name on the left', () => {
  const s = text(positionPdf(build()));
  const W = 841.89 - 72;
  const edges = POSITION_COLUMNS.reduce((a, c) => { a.push(a[a.length - 1] + c.w * W); return a; }, [36]);
  const items = [...s.matchAll(/\/F\d ([\d.]+) Tf ([\d.-]+) [\d.-]+ Td \((.*?)\) Tj/g)].map((m) => ({ size: +m[1], x: +m[2], t: m[3].replace(/\\/g, '') }));   // the file escapes ( and ) with a backslash
  const widthOf = (t, size) => textWidth(t, size, true);
  // the heading of every figure column: the middle of the text sits on the middle of the column
  POSITION_COLUMNS.slice(1).forEach((c, k) => {
    const i = k + 1;
    const mid = (edges[i] + edges[i + 1]) / 2;
    const it = items.find((q) => q.t === c.label && q.size === HEAD);
    assert.ok(it, `no heading ${c.label}`);
    const centre = it.x + widthOf(it.t, HEAD) / 2;
    assert.ok(Math.abs(centre - mid) < 3, `${c.label} is ${Math.abs(centre - mid).toFixed(1)}pt off the middle of its column`);
  });
  const name = items.find((q) => q.t === 'Wheat');
  assert.ok(Math.abs(name.x - (edges[0] + 4)) < 0.5, 'the commodity name should stay on the left');
});

check('cost and cost per hectare sit just before the gross margin', () => {
  const labels = POSITION_COLUMNS.map((c) => c.label);
  const at = labels.indexOf('Gross margin');
  assert.deepEqual(labels.slice(at - 2, at), ['Cost', 'Cost $/ha']);
  const data = build();
  const wheat = data.rows.find((r) => r.commodity.name === 'Wheat');
  const costCol = POSITION_COLUMNS[at - 2];
  const perHa = POSITION_COLUMNS[at - 1];
  assert.equal(costCol.cell(wheat), '$100,000');
  assert.equal(perHa.cell(wheat), '$500');                       // 100,000 over 200 ha
  assert.equal(costCol.total(data.totals), '$150,000');
  assert.equal(perHa.total(data.totals), '$500');                // 150,000 over 300 ha
  const s = text(positionPdf(data));
  for (const w of ['(Cost)', '(Cost $/ha)', '($100,000)', '($500)']) assert.ok(s.includes(w), `missing ${w}`);
});

check('a commodity with no cost entered shows a dash, not a nought', () => {
  const free = { ...positionRows(commodities, fields, sales, [])[0], grossMarginCost: 0 };
  const at = POSITION_COLUMNS.findIndex((c) => c.label === 'Cost');
  assert.equal(POSITION_COLUMNS[at].cell(free), '-');
  assert.equal(POSITION_COLUMNS[at + 1].cell(free), '-');
  assert.equal(POSITION_COLUMNS[at + 1].cell({ ...free, grossMarginCost: 500, area: 0 }), '-', 'no hectares: no per-hectare cost');
});

check('it wears the app green, as the load ticket does: a band on top, a green table heading, tinted bands between', () => {
  const s = text(positionPdf(build()));
  assert.ok(s.includes('0.18 0.49 0.2 rg'), 'no green fill');
  const fills = [...s.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) rg/g)].map((m) => m[0]);
  const count = (c) => fills.filter((f) => f === c).length;
  assert.ok(count('0.18 0.49 0.2 rg') >= 3, 'the title band, the table heading and the tile edges should all be green');
  assert.ok(count('0.93 0.96 0.93 rg') >= 3, 'no banded rows');
  assert.ok(s.includes('0.82 0.9 0.83 rg'), 'the total row is not shaded');
});

check('every second commodity row is banded, starting with the second', () => {
  const more = [{ id: 'b', name: 'Barley', mtmPrice: 300, grossMarginCost: 1000 }, { id: 'p', name: 'Pulses', mtmPrice: 700, grossMarginCost: 1000 }];
  const cs = [...commodities, ...more];
  const fs = [...fields, { id: 'f3', name: 'East', areaHa: 50, commodityId: 'b', yieldTHa: 4, yieldMode: 'estimate' }, { id: 'f4', name: 'West', areaHa: 50, commodityId: 'p', yieldTHa: 1.5, yieldMode: 'estimate' }];
  const rows = positionRows(cs, fs, [], []);
  assert.equal(rows.length, 4);
  const totals = positionTotals(rows);
  const s = text(positionPdf({ rows, totals, overheads: {}, pl: farmProfitLoss(totals.grossMargin, {}, 0, 0), cost: {} }));
  // a banded row is one tint-filled rectangle spanning the table: two of four rows, and none for an empty list
  const wide = [...s.matchAll(/0\.93 0\.96 0\.93 rg\s+36 [\d.]+ 769\.89 18 re f/g)].length;
  assert.equal(wide, 2, `${wide} banded rows`);
});

check('the total row adds the commodities up', () => {
  const data = build();
  const total = POSITION_COLUMNS.map((c) => c.total(data.totals));
  assert.equal(total[0], 'Total');
  assert.equal(total[3], '1,000 t');
  assert.equal(total[4], '500 t');
});

check('whole farm: gross margin, overheads and the profit follow the table', () => {
  const data = build();
  const s = text(positionPdf(data));
  for (const w of ['Whole farm', 'Gross margin', 'Overheads', 'Total overheads', '(Finance)', '(Wages)', '(Profit)']) assert.ok(s.includes(w), `missing ${w}`);
  assert.ok(data.pl.profitLoss > 0);
});

check('bills are listed only when there are some', () => {
  assert.ok(!text(positionPdf(build())).includes('Bills taken off profit'));
  const s = text(positionPdf(build({ cost: { total: 6000, brokerage: 4000, freight: 2000, storage: 0, other: 0 } })));
  for (const w of ['Bills taken off profit', '(Brokerage)', '(-$6,000)']) assert.ok(s.includes(w), `missing ${w}`);
});

check('a loss is called a loss, in the minus', () => {
  const data = build({ overheads: { finance: 900000 } });
  assert.ok(data.pl.profitLoss < 0);
  const s = text(positionPdf(data));
  assert.ok(s.includes('(Loss)') && !s.includes('(Profit)'));
});

check('each result line is green or red by its own sign: a loss made good by opening stock is red, then green', () => {
  const withOpening = [{ ...commodities[0], openingStock: 100, openingValue: 50000 }, commodities[1]];
  const rows = positionRows(withOpening, fields, sales, []);
  const totals = positionTotals(rows);
  // overheads set to leave a loss of 10,000 before the opening stock's 50,000 is counted
  const overheads2 = { finance: Math.round(totals.grossMargin) + 10000 };
  const pl = farmProfitLoss(totals.grossMargin, overheads2, totals.openingValue, 0);
  assert.ok(pl.profitLoss < 0 && pl.profitWithOpening > 0, `needs a loss that opening stock turns round: ${pl.profitLoss}, ${pl.profitWithOpening}`);
  const s = text(positionPdf({ rows, totals, overheads: overheads2, pl, cost: {} }));
  const red = [...s.matchAll(/0\.72 0\.18 0\.15 rg/g)].length;
  assert.equal(red, 2, `${red} red texts: the Loss label and figure only`);
});

check('opening stock adds its two lines and renames the value', () => {
  const withOpening = [{ ...commodities[0], openingStock: 100, openingValue: 30000 }, commodities[1]];
  const rows = positionRows(withOpening, fields, sales, []);
  const totals = positionTotals(rows);
  const pl = farmProfitLoss(totals.grossMargin, overheads, totals.openingValue, 0);
  const s = text(positionPdf({ rows, totals, overheads, pl, cost: {} }));
  for (const w of ['CURRENT CROP VALUE', '(Plus opening stock value)', '(Total including opening stock)']) assert.ok(s.includes(w), `missing ${w}`);
});

check('an empty farm gets a page that says so, not a table of nothing', () => {
  const s = text(positionPdf({ rows: [], totals: positionTotals([]), overheads: {}, pl: farmProfitLoss(0, {}, 0, 0), cost: {} }));
  assert.ok(s.startsWith('%PDF') && s.includes('Nothing to report yet'));
  assert.ok(!s.includes('Whole farm'));
});

check('a long list of commodities runs onto a second page without losing any', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, name: `Crop ${i}`, mtmPrice: 300, grossMarginCost: 1000 }));
  const fs2 = many.map((c, i) => ({ id: `f${i}`, name: `P${i}`, areaHa: 10, commodityId: c.id, yieldTHa: 3, yieldMode: 'estimate' }));
  const rows = positionRows(many, fs2, [], []);
  const totals = positionTotals(rows);
  const s = text(positionPdf({ rows, totals, overheads, pl: farmProfitLoss(totals.grossMargin, overheads, 0, 0), cost: {} }));
  assert.ok(/\/Count [2-9]/.test(s), 'still one page');
  assert.ok(s.includes('(Crop 0)') && s.includes('(Crop 39)'));
  assert.ok(s.includes('page 2'));
});

check('the Position screen offers it, and shares or downloads the file by device', () => {
  const v = readFileSync(new URL('../docs/js/views/position.js', import.meta.url), 'utf8');
  assert.ok(v.includes('id="position-pdf"') && v.includes('positionPdf('), 'no button or no call');
  assert.ok(v.includes('canShareFiles()') && v.includes('downloadFile(') && v.includes('sharePdf('), 'not shared or downloaded');
  assert.ok(v.includes('rows.length ?'), 'offered with nothing to report');
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
