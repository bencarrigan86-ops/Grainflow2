// Run with:
//   node tests/seedpdf.test.mjs
//
// The Seed report as a PDF (portrait, one table per commodity, the screen's own figures), and the rotation history's
// seasons that can be switched on and off.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seedPdf, seedColumns } from '../docs/js/seedpdf.js';
import { seedFigures } from '../docs/js/fertfigures.js';
import { groupFieldsByCommodity, SEED_BUFFER_PCT } from '../docs/js/derived.js';
import { rotationGrid, withoutFarms, withoutSeasons, cropYields } from '../docs/js/fieldhistory.js';
import { rotationCsv, rotationPdf } from '../docs/js/rotationexport.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const text = (bytes) => Buffer.from(bytes).toString('latin1');

const commodities = [{ id: 'w', name: 'Wheat' }, { id: 'c', name: 'Canola' }];
const fields = [
  { id: 'f1', name: 'North', areaHa: 200, commodityId: 'w', seedVariety: 'Scepter', seedRateKgHa: 80 },
  { id: 'f2', name: 'South', areaHa: 100, commodityId: 'w', seedVariety: '', seedRateKgHa: 90 },
  { id: 'f3', name: 'Back', areaHa: 50, commodityId: 'c', seedVariety: 'Hyola', seedRateKgHa: 4 },
];
const groups = groupFieldsByCommodity(commodities, fields, []);
const figs = () => groups.map((g) => seedFigures(g));
const build = (f = figs(), o = { business: 'Test Farm', season: '2026', today: '16-11-2026', bufferPct: SEED_BUFFER_PCT }) => text(seedPdf(f, o));

check('the seed figures: tonnes from rate over area, with the buffer, and the total rate is tonnes over area', () => {
  const wheat = seedFigures(groups.find((g) => g.name === 'Wheat'));
  const north = wheat.rows.find((r) => r.name === 'North');
  assert.equal(north.requiredT, 16);                                   // 200 ha x 80 kg
  assert.ok(Math.abs(north.bufferedT - 16 * (1 + SEED_BUFFER_PCT / 100)) < 1e-9);
  assert.equal(wheat.total.requiredT, 16 + 9);
  assert.ok(Math.abs(wheat.total.rate - (25 * 1000) / 300) < 1e-9);
  assert.equal(north.variety, 'Scepter');
});

check('it is a PDF, portrait A4, with the title, farm, season and day', () => {
  const s = build();
  assert.ok(s.startsWith('%PDF-1.4') && s.trimEnd().endsWith('%%EOF'));
  assert.ok(s.includes('/MediaBox [0 0 595.28 841.89]'), 'not portrait');
  for (const w of ['(SEED)', 'Test Farm', '(2026)', 'Printed 16-11-2026']) assert.ok(s.includes(w), `missing ${w}`);
});

check('each commodity has its table, every paddock with its variety and figures, and a total', () => {
  const s = build();
  for (const w of ['(Wheat)', '(Canola)', '(North)', '(South)', '(Back)', '(Scepter)', '(Hyola)', '(Total)', '(16.00)', '(80)', `(+${SEED_BUFFER_PCT}% t)`]) assert.ok(s.includes(w), `missing ${w}`);
  assert.ok(s.includes('(-)'), 'a paddock with no variety is not marked with a dash');
});

check('the columns add up to the page width', () => {
  assert.ok(Math.abs(seedColumns().reduce((a, c) => a + c.w, 0) - 1) < 0.0005);
});

check('nothing planned gives a page that says so', () => {
  assert.ok(build([]).includes('Nothing to report yet'));
});

check('a long list runs on to more pages with the heading band and the table head each time', () => {
  const many = Array.from({ length: 90 }, (_, i) => ({ id: `m${i}`, name: `Paddock ${i}`, areaHa: 50, commodityId: 'w', seedVariety: 'V', seedRateKgHa: 80 }));
  const s = build(groupFieldsByCommodity(commodities, many, []).map((g) => seedFigures(g)));
  const pages = (s.match(/\/Type \/Page\b/g) || []).length;
  assert.ok(pages >= 3, `only ${pages} pages`);
  assert.ok((s.match(/\(Variety\)/g) || []).length >= pages, 'a page has no table head');
  assert.ok(s.includes('(Wheat \\(continued\\))'));
});

check('the screen takes the table\'s figures from the same place, and offers the PDF', () => {
  const v = read('docs/js/views/reports.js');
  assert.ok(v.includes('seedFigures(g)') && v.includes('id="seed-pdf"') && v.includes('seedPdf(') && v.includes('sharePdf(') && v.includes('downloadFile('));
});

console.log('\n=== rotation history: seasons on and off ===');

const season = (crops) => ({
  commodities: [{ id: 'w', name: 'Wheat' }, { id: 'b', name: 'Barley' }, { id: 'o', name: 'Oats' }],
  fields: Object.entries(crops).map(([name, c]) => ({ id: `${name}`, name, areaHa: 100, commodityId: c, yieldTHa: 3, yieldMode: 'estimate' })),
  movements: [],
});
const years = {
  2023: season({ North: 'o', Old: 'o' }),
  2024: season({ North: 'w' }),
  2025: season({ North: 'w' }),
  2026: season({ North: 'b' }),
};
const grid = rotationGrid(years);

check('leaving a season out leaves its column out, and any paddock that only existed then', () => {
  const g = withoutSeasons(grid, ['2023']);
  assert.deepEqual(g.seasons, ['2024', '2025', '2026']);
  assert.ok(g.rows.some((r) => r.name === 'North') && !g.rows.some((r) => r.name === 'Old'), 'a paddock with nothing in the seasons shown is still listed');
});

check('the crops shown are the ones grown in the seasons shown, and keep their colours', () => {
  const g = withoutSeasons(grid, ['2023']);
  assert.ok(!g.crops.includes('Oats') && g.allCrops.includes('Oats'));
  assert.deepEqual(g.crops, ['Barley', 'Wheat']);
  assert.deepEqual(Object.keys(cropYields(g)[0].bySeason).every((s) => g.seasons.includes(s)), true);
});

check('"same crop as the season before" is kept only where both seasons are still shown', () => {
  const north = (g) => g.rows.find((r) => r.name === 'North').repeats;
  assert.deepEqual(north(grid), [['2024', '2025']], 'the full history changed');
  assert.deepEqual(north(withoutSeasons(grid, ['2024'])), []);
  assert.deepEqual(north(withoutSeasons(grid, ['2023', '2026'])), [['2024', '2025']]);
});

check('it works together with the farms switched off, and with every season off', () => {
  const g = withoutSeasons(withoutFarms(grid, new Set()), new Set(['2025']));
  assert.deepEqual(g.seasons, ['2023', '2024', '2026']);
  assert.deepEqual(withoutSeasons(grid, grid.seasons).seasons, []);
});

check('the CSV and the PDF follow the seasons shown', () => {
  const g = withoutSeasons(grid, ['2023', '2024']);
  const csv = rotationCsv(g, { showYield: true });
  assert.ok(csv.includes('2025 crop') && csv.includes('2026 crop') && !csv.includes('2023 crop') && !csv.includes('2024 crop'));
  const pdf = text(rotationPdf(g, {}));
  assert.ok(pdf.includes('(2025)') && !pdf.includes('(2023)') && !pdf.includes('(2024)'));
});

check('the sheet lists the seasons, remembers the choice, and will not export with none on', () => {
  const v = read('docs/js/views/rotation.js');
  assert.ok(v.includes('class="rot-season"') && v.includes("'grainflow.rotation.hiddenSeasons'"));
  assert.ok(v.includes('withoutSeasons(withoutFarms(fullGrid, hidden), hiddenSeasons)'), 'the farms and seasons are not both applied');
  assert.ok(/if \(nothingOn\(\)\) return;[\s\S]*?downloadCSV\(/.test(v) && /rot-pdf'\)\.addEventListener\('click', \(\) => \{\s*if \(nothingOn\(\)\) return;/.test(v), 'an empty export is allowed');
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
