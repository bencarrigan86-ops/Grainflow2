// Run with:
//   node tests/rotationexport.test.mjs
//
// The rotation and yield history as a CSV for Excel and a landscape PDF: what is in them, who gets the yields, and
// that the screen offers both.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rotationGrid, rotationFarms, withoutFarms } from '../docs/js/fieldhistory.js';
import { rotationCsv, rotationPdf, areaSummary, tintOf, seasonGroups, seasonsPerPage, orientationOf, ORIENTATIONS } from '../docs/js/rotationexport.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// two paddocks over three seasons; the east paddock grows wheat two seasons running
const season = (crops, fields, loads = []) => ({
  commodities: crops.map((name, i) => ({ id: `c${i}`, name })),
  fields, movements: loads,
});
const field = (name, commodityId, areaHa, extra = {}) => ({ id: name + commodityId, name, commodityId, areaHa, yieldMode: 'actual', property: 'Home', ...extra });
const load = (fieldName, fieldId, tons) => ({ id: fieldName + tons, froms: [{ type: 'field', id: fieldId, tons }], tons, tos: [] });
const years = {
  2024: season(['Wheat', 'Canola'], [field('East', 'c0', 100), field('West "Block"', 'c1', 50)]),
  2025: season(['Wheat', 'Canola'], [field('East', 'c0', 100), field('West "Block"', 'c0', 50)]),
  2026: season(['Wheat', 'Barley'], [field('East', 'c0', 100, { yieldMode: 'estimate', estYield: 3 })]),
};
const grid = rotationGrid(years);

console.log('\n=== the CSV ===');
check('a row per paddock, a crop and area per season, and the seasons it repeated a crop', () => {
  const csv = rotationCsv(grid, { showYield: true });
  const lines = csv.split('\r\n');
  assert.match(lines[0], /^Farm,Paddock,2024 crop,2024 area \(ha\),2024 tonnes,2024 yield \(t\/ha\),2025 crop/);
  assert.match(lines[0], /Same crop as the season before$/);
  const east = lines.find((l) => l.startsWith('Home,East'));
  assert.ok(east.includes('Wheat,100'), east);
  assert.ok(east.endsWith('2025; 2026'), east);
});
check('a paddock not in a season is blank there, and a name with quotes is escaped', () => {
  const csv = rotationCsv(grid, { showYield: true });
  assert.ok(csv.includes('"West ""Block"""'));
  const west = csv.split('\r\n').find((l) => l.includes('West'));
  assert.ok(/,,,,,?[^,]*$/.test(west) || west.split(',').filter((c) => c === '').length >= 4, west);
});
check('the farm yield by crop follows after a blank line', () => {
  const csv = rotationCsv(grid, { showYield: true });
  assert.ok(csv.includes('\r\n\r\nCrop (farm area and yield),2024 area (ha)'));
});
check('a role that does not see yields gets no tonnes or yields, but still the hectares by crop', () => {
  const csv = rotationCsv(grid, { showYield: false });
  assert.ok(!/tonnes|yield/i.test(csv), 'no yield words at all');
  assert.ok(csv.includes('2024 crop') && csv.includes('2024 area (ha)'));
  assert.ok(csv.includes('\r\n\r\nCrop (farm area),2024 area (ha)'));
  assert.ok(csv.includes('\r\nAll crops,150'));
});

console.log('\n=== hectares by crop ===');
check('the summary has each crop\'s hectares per season and an All crops row that adds them up', () => {
  const rows = areaSummary(grid);
  const wheat = rows.find((r) => r.crop === 'Wheat');
  assert.equal(wheat.bySeason[2024].areaHa, 100);
  assert.equal(wheat.bySeason[2025].areaHa, 150);
  const all = rows[rows.length - 1];
  assert.equal(all.crop, 'All crops');
  assert.equal(all.bySeason[2024].areaHa, 150);
  assert.equal(all.bySeason[2026].areaHa, 100);
  assert.deepEqual(areaSummary(rotationGrid({})), []);
});
check('the screen shows hectares to every role, and yields only where allowed', () => {
  const v = read('docs/js/views/rotation.js');
  assert.ok(v.includes('areaSummary(grid)') && v.includes('Area by crop across the farm') && v.includes('showYield && b.tons > 0'));
});

console.log('\n=== farms on and off ===');
const twoFarms = rotationGrid({
  2025: season(['Wheat', 'Canola'], [field('East', 'c0', 100, { property: 'Aralu' }), field('West', 'c1', 50, { property: 'Back Creek' }), field('Odd', 'c0', 10, { property: '' })]),
});
check('the farms are listed with their paddock counts, and a paddock with no farm is its own entry', () => {
  assert.deepEqual(rotationFarms(twoFarms), [{ name: '', paddocks: 1 }, { name: 'Aralu', paddocks: 1 }, { name: 'Back Creek', paddocks: 1 }]);
});
check('leaving a farm out drops its paddocks, its crops and its hectares, but the colours stay put', () => {
  const g = withoutFarms(twoFarms, new Set(['Back Creek']));
  assert.deepEqual(g.rows.map((r) => r.name), ['Odd', 'East']);
  assert.deepEqual(g.crops, ['Wheat']);
  assert.deepEqual(g.allCrops, ['Canola', 'Wheat']);
  const all = areaSummary(g).at(-1);
  assert.equal(all.bySeason[2025].areaHa, 110);
  assert.ok(!areaSummary(g).some((r) => r.crop === 'Canola'));
  assert.equal(withoutFarms(g, new Set(['Aralu'])).allCrops.join(), 'Canola,Wheat', 'still the full list after a second pass');
  assert.deepEqual(areaSummary(withoutFarms(twoFarms, ['', 'Aralu', 'Back Creek'])), []);
});
check('the files follow the farms that are on, and a crop keeps its tint', () => {
  const g = withoutFarms(twoFarms, new Set(['Aralu']));
  const csv = rotationCsv(g, { showYield: false });
  assert.ok(csv.includes('West') && !csv.includes('East'));
  assert.ok(Buffer.from(rotationPdf(g, { showYield: false })).toString('latin1').includes('West'));
});
check('the sheet has the farm ticks with Select all and Clear all, and the map has the same buttons', () => {
  const v = read('docs/js/views/rotation.js');
  for (const t of ['rot-farm', 'id="rot-all"', 'id="rot-none"', 'grainflow.rotation.hidden', 'withoutFarms(fullGrid, hidden)']) assert.ok(v.includes(t), t);
  const m = read('docs/js/views/farmmap.js');
  for (const t of ['id="fm-all"', 'id="fm-none"', 'hidden.clear()']) assert.ok(m.includes(t), t);
});

console.log('\n=== the PDF ===');
const text = (b) => Buffer.from(b).toString('latin1');
check('it is a landscape A4 PDF with the title, the crops and the paddocks', () => {
  const b = rotationPdf(grid, { showYield: true, business: 'Carrigan Farms', ngr: '12345', today: '16-11-2026', madeAt: '16-11-2026 09:30' });
  const t = text(b);
  assert.ok(t.startsWith('%PDF'));
  assert.match(t, /\/MediaBox \[0 0 841\.89 595\.28\]/);
  for (const w of ['ROTATION AND YIELD HISTORY', 'Carrigan Farms', 'NGR 12345', 'Made in Grainflow 16-11-2026 09:30', '2 paddocks, 3 seasons', 'East', 'Wheat', 'Canola', 'Area and yield by crop across the farm', 'All crops', '150 ha']) assert.ok(t.includes(w), w);
});
check('a role that does not see yields gets a PDF with no yields in it', () => {
  const t = text(rotationPdf(grid, { showYield: false }));
  assert.ok(!t.includes('t/ha') && !t.includes('Yield by crop'));
  assert.ok(t.includes('East') && t.includes('Area by crop across the farm') && t.includes('All crops'));
});
check('many seasons split across pages, and many paddocks run onto more pages', () => {
  const many = {};
  for (let y = 2010; y < 2030; y += 1) many[y] = season(['Wheat'], [field('East', 'c0', 100)]);
  const g = rotationGrid(many);
  const groups = seasonGroups(g.seasons, seasonsPerPage('landscape'));
  assert.ok(groups.length >= 2 && groups.every((x) => x.length <= seasonsPerPage('landscape')));
  const lots = { 2026: season(['Wheat'], Array.from({ length: 60 }, (_, i) => field(`Paddock ${i}`, 'c0', 10))) };
  const pages = (b) => (text(b).match(/\/Type \/Page\b/g) || []).length;
  assert.ok(pages(rotationPdf(rotationGrid(lots), { showYield: true })) >= 3);
  assert.ok(pages(rotationPdf(g, { showYield: true })) >= 2);
});
check('an empty farm still makes a file', () => {
  assert.ok(text(rotationPdf(rotationGrid({}), {})).startsWith('%PDF'));
  assert.equal(rotationCsv(rotationGrid({}), {}).split('\r\n')[0], 'Farm,Paddock,Same crop as the season before');
});
check('a crop colour becomes a light tint', () => {
  const [r, g, b] = tintOf('#2e7d32');
  assert.ok(r > 0.8 && g > 0.8 && b > 0.8 && r < 1);
  assert.equal(tintOf('nonsense'), 0.94);
});

console.log('\n=== portrait, and the report look ===');
check('portrait is a portrait A4 page with fewer seasons across, and landscape is the default', () => {
  const b = rotationPdf(grid, { orientation: 'portrait', showYield: true });
  assert.match(text(b), /\/MediaBox \[0 0 595\.28 841\.89\]/);
  assert.match(text(rotationPdf(grid, {})), /\/MediaBox \[0 0 841\.89 595\.28\]/);
  assert.ok(seasonsPerPage('portrait') < seasonsPerPage('landscape') && seasonsPerPage('portrait') >= 4);
  assert.equal(orientationOf('portrait'), 'portrait');
  assert.equal(orientationOf('sideways'), 'landscape');
  assert.deepEqual(ORIENTATIONS.map((x) => x.value), ['landscape', 'portrait']);
});
check('twenty seasons need more page sets in portrait than in landscape', () => {
  const many = {};
  for (let y = 2010; y < 2030; y += 1) many[y] = season(['Wheat'], [field('East', 'c0', 100)]);
  const g = rotationGrid(many);
  const pages = (b) => (text(b).match(/\/Type \/Page\b/g) || []).length;
  assert.ok(pages(rotationPdf(g, { orientation: 'portrait' })) > pages(rotationPdf(g, { orientation: 'landscape' })));
});
check('it is laid out like the load report: shaded header band, banded rows, title and foot', () => {
  const src = read('docs/js/rotationexport.js');
  const lr = read('docs/js/loadreport.js');
  for (const piece of ['stroke: null, fill: 0.88', 'stroke: null, fill: 0.96', 'Made in Grainflow', 'size: 18, bold: true', 'size: 11, bold: true, align:']) {
    assert.ok(src.includes(piece) && lr.includes(piece), piece);
  }
});

console.log('\n=== the screen ===');
check('the sheet has both buttons, a portrait or landscape choice, and the roles without yields are given none', () => {
  const v = read('docs/js/views/rotation.js');
  assert.ok(v.includes('id="rot-pdf"') && v.includes('id="rot-csv"'));
  assert.ok(v.includes('id="rot-orient"') && v.includes('rememberOrientation(orientation)'));
  assert.ok(v.includes('rotationCsv(grid, { showYield })') && v.includes('orientation, showYield'));
  assert.ok(v.includes('sharePdf(') && v.includes('downloadCSV('));
});

console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
process.exit(failures ? 1 : 0);
