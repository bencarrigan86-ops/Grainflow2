// Run with:
//   node tests/pastseasons.test.mjs
//
// Past seasons from the farm's own records: reading the CSV, marrying paddock names to the current ones, and what is stored.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePastSeasons, planPastSeasons, matchPaddock, seasonRecords } from '../docs/js/pastseasons.js';
import { rotationGrid } from '../docs/js/fieldhistory.js';
import { fieldTons } from '../docs/js/derived.js';
import { ALLOWED } from '../docs/js/import.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const CSV = [
  'Season,Farm,Paddock,Commodity,Variety,Ha,Yield (t/ha),Yield is,Notes',
  '2024,Sunnyridge,SR1-3,Wheat,Lancer,204.27,5.07,Actual,',
  '2024,Sunnyridge,SR Dam Sth,Wheat,Lancer,75,4.97,Actual,',
  '2023,Sunnyridge,SR1-3,Chickpeas,Hattrick,204.27,1.04,Estimate,',
  '2023,Hillstead,H3,Wheat,,281.2,3.5,Estimate,',
  '',
].join('\r\n');

console.log('\n=== reading the file ===');
check('rows are read with their farm, variety, area, yield and whether it was recorded', () => {
  const { rows, errors } = parsePastSeasons(CSV);
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { line: 2, season: '2024', farm: 'Sunnyridge', paddock: 'SR1-3', commodity: 'Wheat', variety: 'Lancer', areaHa: 204.27, yieldTHa: 5.07, recorded: true, notes: '' });
  assert.equal(rows[2].recorded, false);
});
check('tonnes will do in place of a yield, and other heading names, semicolons and quotes work', () => {
  const { rows, errors } = parsePastSeasons('Year;Field;Crop;Area;Tonnes\n2022;"A 1, north";Barley;100;450');
  assert.deepEqual(errors, []);
  assert.equal(rows[0].paddock, 'A 1, north');
  assert.equal(rows[0].yieldTHa, 4.5);
  assert.equal(rows[0].recorded, false);
});
check('missing headings and bad rows are said, row by row, and the good rows still come through', () => {
  assert.match(parsePastSeasons('Season,Paddock,Ha,Tonnes\n2024,A,10,40').errors[0], /Commodity/);
  assert.match(parsePastSeasons('Season,Paddock,Commodity,Ha\n2024,A,Wheat,10').errors[0], /Yield \(t\/ha\) or a Tonnes/);
  assert.deepEqual(parsePastSeasons('').errors, ['The file has no rows.']);
  const r = parsePastSeasons('Season,Paddock,Commodity,Ha,Yield (t/ha)\n2024,A,Wheat,10,4\n2024,,Wheat,10,4\n2024,B,Wheat,lots,4\n2024,C,Wheat,10,x\n');
  assert.equal(r.rows.length, 1);
  assert.equal(r.errors.length, 3);
  assert.match(r.errors[0], /Row 3/);
  assert.match(r.errors[1], /Row 4.*area/);
  assert.match(r.errors[2], /Row 5.*yield/);
});

console.log('\n=== marrying the names ===');
const paddocks = ['SR1-3', 'SR Dam Sth', 'A3/4', 'B3', 'A 7', 'R6-7', 'SR9/11', 'SR09A', 'SR9a'];
check('the same name matches whatever the case and spacing; a close name matches only when it points at one paddock', () => {
  assert.deepEqual(matchPaddock('sr1-3', paddocks), { name: 'SR1-3', how: 'name' });
  assert.deepEqual(matchPaddock('A7', paddocks), { name: 'A 7', how: 'close' });
  assert.equal(matchPaddock('R6/7', paddocks), null, 'a slash is not a hyphen');
  assert.equal(matchPaddock('SR9A', paddocks)?.name, 'SR9a', 'an exact match (ignoring case) wins over a close one');
  assert.equal(matchPaddock('SR9 A', ['SR09A', 'SR9A']), null, 'two close matches are no match');
  assert.equal(matchPaddock('Nowhere', paddocks), null);
});
check('seasons are planned oldest first, with matched names, kept names and the seasons the farm already has', () => {
  const { rows } = parsePastSeasons(CSV);
  const plan = planPastSeasons(rows, { seasons: ['2024', '2025'], paddocks });
  assert.deepEqual(plan.seasons.map((s) => [s.label, s.exists, s.fields.length, s.matched]), [['2023', false, 2, 1], ['2024', true, 2, 2]]);
  assert.deepEqual(plan.unmatched, [{ name: 'H3', seasons: ['2023'] }]);
  const s24 = plan.seasons[1];
  assert.equal(s24.ha, 279.3);
  assert.equal(s24.tons, 1408);
});
check('two rows for one paddock are added together: hectares, tonnes and a yield worked back from them', () => {
  const { rows } = parsePastSeasons('Season,Paddock,Commodity,Ha,Yield (t/ha),Yield is\n2024,A3/4,Wheat,200,5,Actual\n2024,a3/4,Wheat,26,4,Actual\n2024,A3/4,Wheat,0,0,Actual');
  const plan = planPastSeasons(rows, { paddocks: ['A3/4'] });
  const [f] = plan.seasons[0].fields;
  assert.equal(plan.seasons[0].fields.length, 1);
  assert.equal(f.name, 'A3/4');
  assert.equal(f.areaHa, 226);
  assert.equal(f.yieldTHa, 4.885);
});
check('when the rows disagree about the crop the crop on more hectares stands for the paddock, and says so', () => {
  const { rows } = parsePastSeasons('Season,Paddock,Commodity,Ha,Yield (t/ha),Yield is\n2020,SR18,Wheat,16.72,3.6,Actual\n2020,SR22,Barley,43.9,4.6,Estimate');
  const [f] = planPastSeasons(rows, { paddocks: ['SR18/22'] }).seasons[0].fields;
  assert.equal(f.matched, false);
  const merged = planPastSeasons(rows.map((r) => ({ ...r, paddock: 'SR18/22' })), { paddocks: ['SR18/22'] }).seasons[0].fields[0];
  assert.equal(merged.commodity, 'Barley');
  assert.equal(merged.mixed, true);
  assert.equal(merged.recorded, false, 'recorded only when every part is');
});

console.log('\n=== what is stored ===');
const farmCommodities = [
  { id: 'cw', name: 'Wheat', angleOfRepose: 24, testWeight: 0.82, nPerTonne: 44 },
  { id: 'cc', name: 'Chickpeas', angleOfRepose: 28, testWeight: 0.76, nPerTonne: 35 },
];
let n = 0;
const makeId = () => `id${n += 1}`;
check('commodities take the farm\'s own properties, a variant takes its parent\'s, and each is made once', () => {
  const { rows } = parsePastSeasons('Season,Paddock,Commodity,Ha,Yield (t/ha),Yield is\n2021,A,Wheat,10,4,Actual\n2021,B,wheat,10,4,Actual\n2021,C,Wheat Org,10,3,Estimate\n2021,D,Cotton,10,2,Estimate');
  const rec = seasonRecords(planPastSeasons(rows, { paddocks: [] }).seasons[0], farmCommodities, makeId);
  assert.deepEqual(rec.commodities.map((c) => c.name), ['Wheat', 'Wheat Org', 'Cotton']);
  assert.equal(rec.commodities[0].testWeight, 0.82);
  assert.equal(rec.commodities[1].nPerTonne, 44);
  assert.equal(rec.commodities[2].testWeight, 0);
  assert.equal(rec.fields[0].commodityId, rec.fields[1].commodityId);
});
check('a paddock is stored with its yield mode, variety and farm; tonnes come from area x yield', () => {
  const { rows } = parsePastSeasons(CSV);
  const season = planPastSeasons(rows, { paddocks }).seasons[1];
  const rec = seasonRecords(season, farmCommodities, makeId);
  const f = rec.fields.find((x) => x.name === 'SR1-3');
  assert.equal(f.yieldMode, 'recorded');
  assert.equal(f.seedVariety, 'Lancer');
  assert.equal(f.property, 'Sunnyridge');
  assert.equal(f.__hasProperty, true);
  assert.equal(Math.round(fieldTons(f, [])), 1036);
});
check('the rotation history shows a recorded yield as it was, and an estimate as an estimate', () => {
  const { rows } = parsePastSeasons(CSV);
  const plan = planPastSeasons(rows, { paddocks });
  const years = {};
  for (const s of plan.seasons) { const r = seasonRecords(s, farmCommodities, makeId); years[s.label] = { fields: r.fields, commodities: r.commodities, movements: [] }; }
  const row = rotationGrid(years).rows.find((r) => r.name === 'SR1-3');
  assert.equal(row.cells['2024'].actual, true);
  assert.equal(row.cells['2023'].actual, false);
  assert.equal(row.property, 'Sunnyridge');
});
check('recorded is an allowed yield mode in the app and in the database', () => {
  assert.ok(ALLOWED.yieldMode.includes('recorded'));
  const m = read('supabase/migrations/20261118100000_yield_recorded.sql');
  assert.ok(m.includes("'estimate', 'actual', 'recorded'") && m.includes('field_agronomy'));
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes("check (yield_mode in ('estimate', 'actual', 'recorded'))"));
});

console.log('\n=== the screen ===');
check('Settings offers the import, the sheet imports only seasons the farm does not have, and the db never overwrites one', () => {
  assert.ok(read('docs/js/views/settings.js').includes('id="import-past"') && read('docs/js/views/settings.js').includes('openPastSeasonsSheet()'));
  const v = read('docs/js/views/pastseasons.js');
  assert.ok(v.includes('planPastSeasons(') && v.includes('s.exists') && v.includes('db.addPastSeason('));
  const st = read('docs/js/storage.js');
  assert.ok(/addPastSeason\(year, \{ commodities, fields \}\) \{[\s\S]*?if \(!label \|\| data\.years\[label\]\) return false;/.test(st));
  assert.ok(!/addPastSeason[\s\S]{0,400}data\.currentYear = /.test(st), 'the current season does not change');
});

console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
process.exit(failures ? 1 : 0);
