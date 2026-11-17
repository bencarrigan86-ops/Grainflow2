// Run with:
//   node tests/seasonaverages.test.mjs
//
// Averages by commodity across seasons: yield weighted by area, price weighted by tonnes, and what is left out.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seasonAverages, finishedSeasons, averagesRows, AVERAGES_COLUMNS } from '../docs/js/seasonaverages.js';
import { toCSV } from '../docs/js/csv.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const season = (wheatFields, sales = [], extra = []) => ({
  commodities: [{ id: 'w', name: 'Wheat' }, { id: 'f', name: 'Fallow' }, ...extra],
  fields: wheatFields,
  sales, movements: [],
});
const fld = (ha, y, mode = 'recorded', commodityId = 'w') => ({ id: `f${Math.random()}`, areaHa: ha, yieldTHa: y, yieldMode: mode, commodityId });
const sale = (tons, price, freight = 0, commodityId = 'w') => ({ id: `s${Math.random()}`, commodityId, tons, price, freight, tonsDelivered: tons });

const years = {
  2020: season([fld(100, 4), fld(300, 2)], [sale(500, 300, 20), sale(100, 400)]),    // 1000 t on 400 ha = 2.5 t/ha
  2021: season([fld(200, 3)]),                                                          // 600 t on 200 ha
  2022: season([fld(50, 0)]),                                                           // grown, nothing made yet
  2023: season([fld(100, 5, 'estimate')]),                                              // a forecast
  2024: season([fld(500, 0, 'recorded', 'f')]),                                         // fallow
};

console.log('\n=== yield ===');
check('yield is the tonnes over the hectares of the seasons that made tonnes, so big paddocks count for more', () => {
  const r = seasonAverages(years, ['2020', '2021']);
  const w = r.commodities.find((c) => c.name === 'Wheat');
  assert.equal(w.seasons['2020'].yieldTHa, 2.5);
  assert.equal(w.total.ha, 600); assert.equal(w.total.tons, 1600);
  assert.equal(w.total.yieldTHa, 2.67);      // 1600 / 600, not the plain average of 2.5 and 3 (2.75)
  assert.equal(w.total.seasonsGrown, 2);
});
check('a season with no tonnes is left out of the average, and fallow is not a crop', () => {
  const r = seasonAverages(years, ['2020', '2021', '2022', '2024']);
  assert.equal(r.commodities.length, 1);
  const w = r.commodities[0];
  assert.equal(w.total.seasonsGrown, 2);
  assert.equal(w.seasons['2022'].yieldTHa, 0);
});
check('a forecast yield is marked in the season and carries into the average', () => {
  const r = seasonAverages(years, ['2020', '2023']);
  const w = r.commodities[0];
  assert.equal(w.seasons['2023'].est, true); assert.equal(w.seasons['2020'].est, false); assert.equal(w.total.est, true);
});

console.log('\n=== price ===');
check('price is weighted by tonnes sold: the contract price, and what is left after freight and levies', () => {
  const r = seasonAverages(years, ['2020']);
  const t = r.commodities[0].total;
  assert.equal(t.soldTons, 600);
  assert.equal(t.contractPrice, 317);                        // (500 x 300 + 100 x 400) / 600
  assert.equal(t.netPrice, 300);                             // (500 x 280 + 100 x 400) / 600 = 300
  assert.equal(t.soldValue, 180000);
});
check('sales in a season the crop was not grown in are still counted', () => {
  const y = { 2022: season([], [sale(200, 500)]) };
  const r = seasonAverages(y, ['2022']);
  assert.equal(r.commodities[0].total.soldTons, 200);
  assert.equal(r.commodities[0].total.yieldTHa, 0);
});

console.log('\n=== which seasons, and the file ===');
check('finished seasons are up to the current one; next year\'s plan is left out until it is picked', () => {
  assert.deepEqual(finishedSeasons(['2027', '2025', '2026', '2020'], '2026'), ['2020', '2025', '2026']);
  assert.deepEqual(finishedSeasons(['Sample 2026', 'Other'], 'Sample 2026'), ['Other', 'Sample 2026']);
});
check('the Excel file has a row per crop per season, then one for the whole span, and leaves the money out when asked', () => {
  const r = seasonAverages(years, ['2020', '2021']);
  const rows = averagesRows(r);
  assert.equal(rows.length, 3);
  assert.equal(rows[2].season, 'All 2 seasons'); assert.equal(rows[2].yieldTHa, 2.67);
  const csv = toCSV(rows, AVERAGES_COLUMNS(true));
  assert.ok(csv.startsWith('Commodity,Season,Area (ha),Tonnes,Yield (t/ha),Yield is,Tonnes sold,Average contract price'));
  assert.ok(!toCSV(averagesRows(r, { showMoney: false }), AVERAGES_COLUMNS(false)).includes('price'));
});

console.log('\n=== the screen ===');
check('Production offers it to roles that see yields, and the sheet remembers the seasons ticked', () => {
  const p = read('docs/js/views/production.js');
  assert.ok(p.includes('id="open-averages"') && p.includes('openAveragesSheet()') && p.includes('openReportsSheet(fields.length > 0, showYield)') && /showYield \? '<button[^']*open-averages/.test(p));
  const v = read('docs/js/views/averages.js');
  assert.ok(v.includes('canSeeYield(') && v.includes('finishedSeasons(') && v.includes('grainflow.averages.seasons') && v.includes('exportRowsAsCSV('));
});

console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
process.exit(failures ? 1 : 0);
