// Run with:
//   node tests/gmpdf.test.mjs
//
// The Gross margin report as a PDF: portrait A4, built from the screen's own figures (gmReport), a paddock's own cost starred.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gmPdf, GM_COLUMNS } from '../docs/js/gmpdf.js';
import { gmReport } from '../docs/js/grossmargin.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const text = (bytes) => Buffer.from(bytes).toString('latin1');

const commodities = [{ id: 'w', name: 'Wheat', mtmPrice: 400, openingStock: 0, retainedSeed: 0, grossMarginCost: 160000 }];
const fields = [
  { id: 'f1', name: 'North', areaHa: 100, commodityId: 'w', yieldTHa: 1, yieldMode: 'estimate', gmCostHa: 250 },
  { id: 'f2', name: 'South', areaHa: 300, commodityId: 'w', yieldTHa: 3, yieldMode: 'estimate' },
];
const sales = [{ id: 's1', commodityId: 'w', tons: 200, price: 500, tonsDelivered: 0, freight: 0, leviesPct: 0, premiumDiscount: 0, ginning: 0 }];
const opts = { business: 'Test Farm', season: '2026', today: '19-11-2026' };
const rep = () => gmReport(commodities, fields, sales, []);

check('the PDF is portrait A4, titled, with each paddock, a total and the whole farm', () => {
  const s = text(gmPdf(rep(), opts));
  assert.ok(s.startsWith('%PDF-1.4') && s.trimEnd().endsWith('%%EOF'));
  assert.ok(s.includes('/MediaBox [0 0 595.28 841.89]'));
  for (const w of ['(GROSS MARGIN)', 'Test Farm', '(2026)', 'Printed 19-11-2026', '(North)', '(South)', '(Total)', '(Whole farm)', '(Gross margin)', '(GM /ha)', '(Cost /ha)']) assert.ok(s.includes(w), `missing ${w}`);
});

check('a paddock with a cost of its own is starred, one on the crop\'s cost is not', () => {
  const s = text(gmPdf(rep(), opts));
  assert.ok(s.includes('(250*)'), 'North has its own 250');
  assert.ok(s.includes('(400)') && !s.includes('(400*)'), 'South is on the crop\'s 160000 over 400 ha');
});

check('the figures are the report\'s: revenue per hectare, and the whole farm in dollars', () => {
  const r = rep();
  const s = text(gmPdf(r, opts));
  const g = r.groups[0];
  assert.ok(s.includes(`(${Math.round(g.fields[1].revenueHa).toLocaleString('en-AU')})`));
  assert.ok(s.includes(`$${Math.round(Math.abs(r.total.cost)).toLocaleString('en-AU')}`), 'whole farm cost in dollars');
});

check('the columns add up to the page width, and an empty report says so', () => {
  assert.ok(Math.abs(GM_COLUMNS.reduce((a, c) => a + c.w, 0) - 1) < 0.0005);
  assert.ok(text(gmPdf({ groups: [], total: {} }, opts)).includes('Nothing to report yet'));
});

check('a loss is shown with its minus sign, not as a bracket or a blank', () => {
  const lossy = gmReport([{ ...commodities[0], grossMarginCost: 4000000 }], fields, sales, []);
  assert.ok(lossy.total.gm < 0);
  assert.ok(text(gmPdf(lossy, opts)).includes('-$'));
});

check('the report has a PDF button that shares where the phone can and downloads elsewhere, and keeps it docked after a cost change', () => {
  const rp = read('docs/js/views/reports.js');
  assert.ok(rp.includes("id=\"gm-pdf\"") && rp.includes('gmPdf({ groups, total }'));
  assert.ok(rp.includes('dockPdf(root);   // the button is redrawn'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
