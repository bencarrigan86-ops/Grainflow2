// Run with:
//   node tests/positionpdf.test.mjs
//
// The Position screen as a PDF: it is a real PDF, every commodity is on it with the figures the screen shows, the
// whole-farm lines follow, and an empty farm and a loss are handled.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { positionPdf, POSITION_COLUMNS } from '../docs/js/positionpdf.js';
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
