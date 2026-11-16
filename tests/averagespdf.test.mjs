// Run with:
//   node tests/averagespdf.test.mjs
//
// Averages by commodity as a PDF: a real portrait PDF, every crop on it with its average yield and price and its
// season-by-season rows, estimates flagged, an empty pick handled, and the screen wired to share or download it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { averagesPdf, AVERAGES_PDF_COLUMNS } from '../docs/js/averagespdf.js';
import { seasonAverages } from '../docs/js/seasonaverages.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const text = (bytes) => Buffer.from(bytes).toString('latin1');

const season = (yieldTHa, mode, price) => ({
  commodities: [{ id: 'w', name: 'Wheat' }, { id: 'c', name: 'Canola' }],
  fields: [
    { id: 'f1', name: 'North', areaHa: 100, commodityId: 'w', yieldTHa, yieldMode: mode },
    { id: 'f2', name: 'South', areaHa: 50, commodityId: 'c', yieldTHa: 2, yieldMode: 'estimate' },
  ],
  sales: [{ id: 's1', commodityId: 'w', tons: 200, price, freight: 0, leviesPct: 0, tonsDelivered: 0 }],
  movements: [],
});
const years = { 2024: season(3, 'estimate', 300), 2025: season(4, 'estimate', 400) };
const result = seasonAverages(years, ['2024', '2025']);
const pdf = (r = result, o = { business: 'Test Farm', today: '16-11-2026' }) => text(averagesPdf(r, o));

check('it is a PDF, portrait A4', () => {
  const s = pdf();
  assert.ok(s.startsWith('%PDF-1.4') && s.trimEnd().endsWith('%%EOF'));
  assert.ok(s.includes('/MediaBox [0 0 595.28 841.89]'), 'not portrait A4');
});

check('the title, the farm, the span of seasons and the day are on it', () => {
  const s = pdf();
  for (const w of ['AVERAGES', 'Test Farm', '2024 to 2025', 'Printed 16-11-2026']) assert.ok(s.includes(w), `missing ${w}`);
});

check('each crop has its heading, average yield, average price and a row for every season', () => {
  const s = pdf();
  const wheat = result.commodities.find((c) => c.name === 'Wheat');
  assert.equal(wheat.total.yieldTHa, 3.5);
  for (const w of ['(Wheat)', '(Canola)', '(3.50 t/ha est)', '(2.00 t/ha est)', '(2024)', '(2025)', '(All seasons)', '($350/t)']) assert.ok(s.includes(w), `missing ${w}`);
});

check('a season with a forecast yield says est, and the note explaining it appears only then', () => {
  assert.ok(pdf().includes('(4.00 est)') && pdf().includes('means at least one season'));
  const recorded = { labels: ['2024'], commodities: [{ name: 'Wheat', seasons: { 2024: { ha: 100, tons: 300, yieldTHa: 3, est: false, soldTons: 0, netPrice: 0, contractPrice: 0 } }, total: { seasonsGrown: 1, ha: 100, tons: 300, yieldTHa: 3, est: false, soldTons: 0, netPrice: 0, contractPrice: 0, soldValue: 0 } }] };
  assert.ok(!pdf(recorded).includes('means at least one season') && !pdf(recorded).includes('3.00 est'));
});

check('a crop that sold nothing says so rather than showing a price', () => {
  const s = pdf();
  assert.ok(s.includes('(no sales)'), 'canola sold nothing but is not marked');
});

check('the columns add up to the table width', () => {
  const sum = AVERAGES_PDF_COLUMNS.reduce((a, c) => a + c.w, 0);
  assert.ok(Math.abs(sum - 1) < 0.0005, `columns add up to ${sum.toFixed(3)}`);
});

check('nothing grown or sold gives a page that says so, still a PDF', () => {
  const s = pdf({ labels: ['2024'], commodities: [] });
  assert.ok(s.startsWith('%PDF-1.4') && s.includes('Nothing grown or sold'));
});

check('many crops over many seasons run on to more pages, each with its heading band', () => {
  const many = { labels: ['2020', '2021'], commodities: Array.from({ length: 14 }, (_, i) => ({
    name: `Crop ${i}`,
    seasons: { 2020: { ha: 100, tons: 300, yieldTHa: 3, est: false, soldTons: 100, netPrice: 300, contractPrice: 310 }, 2021: { ha: 100, tons: 300, yieldTHa: 3, est: false, soldTons: 100, netPrice: 300, contractPrice: 310 } },
    total: { seasonsGrown: 2, ha: 200, tons: 600, yieldTHa: 3, est: false, soldTons: 200, netPrice: 300, contractPrice: 310, soldValue: 60000 },
  })) };
  const s = pdf(many);
  const pages = (s.match(/\/Type \/Page\b/g) || []).length;
  assert.ok(pages >= 3, `only ${pages} pages`);
  assert.ok((s.match(/\(AVERAGES\)/g) || []).length === pages, 'a page has no heading band');
});

check('the Averages sheet offers the PDF beside Excel and shares or downloads it', () => {
  const v = read('docs/js/views/averages.js');
  assert.ok(v.includes('id="av-pdf"') && v.includes('id="av-csv"'), 'a button is missing');
  assert.ok(v.includes('averagesPdf(') && v.includes('sharePdf(') && v.includes('downloadFile('), 'the PDF is not built and shared or downloaded');
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
