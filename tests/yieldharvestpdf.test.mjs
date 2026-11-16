// Run with:
//   node tests/yieldharvestpdf.test.mjs
//
// The Yield and Harvest reports as PDFs (portrait A4, in the style of the Seed page), built from the screens' own figures:
// the Harvest one with no tonnes for a role that is not shown yields. Also that the harvest report lists the commodity with the
// most tonnes first.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { yieldPdf, YIELD_COLUMNS } from '../docs/js/yieldpdf.js';
import { harvestPdf, HARVEST_COLUMNS, HARVEST_COLUMNS_NO_YIELD } from '../docs/js/harvestpdf.js';
import { yieldFigures } from '../docs/js/fertfigures.js';
import { groupFieldsByCommodity } from '../docs/js/derived.js';
import { harvestReport, siloSpace } from '../docs/js/harvest.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const text = (bytes) => Buffer.from(bytes).toString('latin1');

const commodities = [{ id: 'o', name: 'Oats' }, { id: 'w', name: 'Wheat' }, { id: 'c', name: 'Canola' }];
const fields = [
  { id: 'f1', name: 'North', areaHa: 200, commodityId: 'w', yieldMode: 'estimate', yieldTHa: 4 },
  { id: 'f2', name: 'South', areaHa: 100, commodityId: 'w', yieldMode: 'estimate', yieldTHa: 3, harvestDone: true },
  { id: 'f3', name: 'Back', areaHa: 50, commodityId: 'c', yieldMode: 'estimate', yieldTHa: 2 },
  { id: 'f4', name: 'Creek', areaHa: 10, commodityId: 'o', yieldMode: 'estimate', yieldTHa: 3, harvestHaLeft: 4 },
];
const storages = [
  { id: 's1', name: 'Silo 1', kind: 'silo', commodityId: 'w', capacityTons: 500 },
  { id: 's2', name: 'Silo 2', kind: 'silo', commodityId: null, capacityTons: 300 },
];
const opts = { business: 'Test Farm', season: '2026', today: '16-11-2026' };

// ---- yield ----
const groups = groupFieldsByCommodity(commodities, fields, []);
const yfigs = () => groups.map((g) => yieldFigures(g, []));

check('the yield figures: tonnes over area per paddock and over the whole area in the total', () => {
  const wheat = yieldFigures(groups.find((g) => g.name === 'Wheat'), []);
  const north = wheat.rows.find((r) => r.name === 'North');
  assert.equal(north.tons, 800);
  assert.equal(north.yieldTHa, 4);
  assert.equal(north.mode, 'Estimate');
  assert.equal(wheat.total.tons, 1100);
  assert.ok(Math.abs(wheat.total.yieldTHa - 1100 / 300) < 1e-9, 'tonnes over the whole area, not a mean of the paddocks');
});

check('the biggest commodity is first, whatever order they were saved in', () => {
  assert.deepEqual(groups.map((g) => g.name), ['Wheat', 'Canola', 'Oats']);
});

check('the yield PDF: portrait, titled, each commodity with its paddocks and a total, and the whole farm', () => {
  const s = text(yieldPdf(yfigs(), opts));
  assert.ok(s.startsWith('%PDF-1.4') && s.trimEnd().endsWith('%%EOF'));
  assert.ok(s.includes('/MediaBox [0 0 595.28 841.89]'));
  for (const w of ['(YIELD)', 'Test Farm', '(2026)', 'Printed 16-11-2026', '(North)', '(South)', '(Back)', '(Creek)', '(Total)', '(Estimate)', '(800.0)', '(4.00)', '(Whole farm)', '(Yield t/ha)']) assert.ok(s.includes(w), `missing ${w}`);
  assert.ok(s.includes('(Wheat   1,100.0 t)') || s.includes('Wheat   1,100.0 t'), 'the commodity heading carries its tonnes');
  const area = 200 + 100 + 50 + 10;
  assert.ok(s.includes(`(${area.toLocaleString('en-AU', { minimumFractionDigits: 1 })} ha)`), 'whole farm area');
});

check('the yield columns add up to the page width, and nothing planned says so', () => {
  assert.ok(Math.abs(YIELD_COLUMNS.reduce((a, c) => a + c.w, 0) - 1) < 0.0005);
  assert.ok(text(yieldPdf([], opts)).includes('Nothing to report yet'));
});

check('a long yield list runs on to more pages with its heading and table head again', () => {
  const many = Array.from({ length: 90 }, (_, i) => ({ id: `x${i}`, name: `Paddock ${i}`, areaHa: 10 + i, commodityId: 'w', yieldMode: 'estimate', yieldTHa: 3 }));
  const g = groupFieldsByCommodity(commodities, many, []);
  const s = text(yieldPdf(g.map((x) => yieldFigures(x, [])), opts));
  assert.ok((s.match(/\/Type \/Page\b/g) || []).length >= 3, 'three pages or more');
  assert.ok(s.includes('continued'), 'the commodity is named again on the next page');
});

// ---- harvest ----
const report = harvestReport(commodities, fields, []);
const space = siloSpace(storages, [], { minRoom: 20 });
const nameOf = (id) => commodities.find((c) => c.id === id)?.name || 'No commodity';
const hbuild = (showYield, o = {}) => text(harvestPdf({ ...report, space, minRoom: 20, nameOf, showYield, ...opts, ...o }));

check('the harvest report lists the commodity with the most tonnes first', () => {
  assert.deepEqual(report.groups.map((g) => g.name), ['Wheat', 'Canola', 'Oats']);
});

check('the harvest PDF with yields: whole farm, the room in the silos, each commodity with estimate, in and to come', () => {
  const s = hbuild(true);
  assert.ok(s.includes('/MediaBox [0 0 595.28 841.89]'));
  for (const w of ['(HARVEST)', '(Whole farm)', '(Harvested)', '(Still to come)', '(Room in the silos)', '(Room left)', '(Silo 1)', '(Silo 2)', '(Wheat)', '(North)', '(Est t)', '(To come t)', '(In t)', '(Hectares finished)']) {
    assert.ok(s.includes(w) || s.includes(w.replace(')', '').replace('(', '')), `missing ${w}`);
  }
  assert.ok(s.includes('(Done)'), 'a finished paddock says Done');
});

check('the harvest PDF for a role with no yields has no tonnes, estimates or to-come figures', () => {
  const s = hbuild(false);
  for (const w of ['(Cut)', '(Left to harvest)', '(Of the area done)', '(Room in the silos)', '(Area ha)', '(To cut ha)']) assert.ok(s.includes(w), `missing ${w}`);
  for (const w of ['(Harvested)', '(Still to come)', '(Est t)', '(In t)', '(To come t)', 'Room to spare', 'Short of room']) assert.ok(!s.includes(w), `${w} must not be there`);
  // the estimate for the paddocks is 800 + 300 + 100 + 30 t; none of it may appear
  for (const w of ['(800)', '(1,100)', '(1,230)']) assert.ok(!s.includes(w), `${w} is a tonnage`);
});

check('the harvest columns add up to the page width', () => {
  assert.ok(Math.abs(HARVEST_COLUMNS.reduce((a, c) => a + c.w, 0) - 1) < 0.0005);
  assert.ok(Math.abs(HARVEST_COLUMNS_NO_YIELD.reduce((a, c) => a + c.w, 0) - 1) < 0.0005);
});

check('nothing planned gives a page that says so', () => {
  assert.ok(text(harvestPdf({ groups: [], farm: {}, space: {}, ...opts })).includes('Nothing to report yet'));
});

check('the reports screen has both buttons, built from the same figures, in both versions of harvest', () => {
  const r = read('docs/js/views/reports.js');
  assert.ok(r.includes('id="yield-pdf"') && r.includes('exportYieldPdf(groups, movements)') && r.includes('yieldFigures(g, movements)'));
  assert.ok(r.includes('id="harvest-pdf"') && r.includes("exportHarvestPdf({ groups, farm, seasons: scope ? [] : seasons, scopeLabel: scope ? scope.label : '', space, minRoom, nameOf, showYield })"));
  assert.ok(r.includes('pdfButton + picker + harvestNoYieldHtml'), 'the no-yield version has the button too');
  assert.ok(r.includes('const { rows: figures, total } = yieldFigures(g, movements);'), 'the table takes its figures from the shared place');
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
