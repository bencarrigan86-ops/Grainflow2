// Run with:
//   node tests/doublecrop.test.mjs
//
// Double crop: a paddock ticked as grown straight after another crop. Its yield is shown apart from the rest ("after fallow") in
// Position and in Averages by commodity (screen, PDF and Excel), while the crop's own average stays the all-paddocks average.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { productionByCommodity, doubleCropSplit } from '../docs/js/derived.js';
import { seasonAverages, averagesRows, AVERAGES_COLUMNS } from '../docs/js/seasonaverages.js';
import { averagesPdf } from '../docs/js/averagespdf.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const text = (bytes) => Buffer.from(bytes).toString('latin1');

const wheat = { id: 'w', name: 'Wheat' };
const fld = (id, ha, y, extra = {}) => ({ id, name: id, areaHa: ha, yieldTHa: y, yieldMode: 'estimate', commodityId: 'w', ...extra });
// 300 ha after fallow at 3 t/ha, 100 ha double cropped at 2 t/ha: the crop's average is 1100 t over 400 ha
const fields = [fld('a', 200, 3), fld('b', 100, 3), fld('c', 100, 2, { doubleCrop: true })];

console.log('\n=== the split ===');
check('a crop with a double-cropped paddock has the yield of each side, and its own average is still all of them', () => {
  const [row] = productionByCommodity([wheat], fields, []);
  assert.equal(row.yieldTHa, 2.75, 'the crop average is unchanged');
  assert.equal(row.split.double.yieldTHa, 2); assert.equal(row.split.double.area, 100); assert.equal(row.split.double.count, 1);
  assert.equal(row.split.normal.yieldTHa, 3); assert.equal(row.split.normal.area, 300); assert.equal(row.split.normal.count, 2);
});
check('a crop with none ticked has no split, so nothing extra is shown', () => {
  assert.equal(doubleCropSplit([fld('a', 200, 3)], []), null);
  assert.equal(productionByCommodity([wheat], [fld('a', 200, 3)], [])[0].split, null);
});
check('a crop with every paddock double cropped shows no after-fallow yield', () => {
  const s = doubleCropSplit([fld('a', 100, 2, { doubleCrop: true })], []);
  assert.equal(s.normal.yieldTHa, 0); assert.equal(s.normal.count, 0); assert.equal(s.double.yieldTHa, 2);
});
check('on actual yield, a paddock counts the tonnes carted off it', () => {
  const moves = [{ id: 'm1', date: '2026-01-01', tons: 150, froms: [{ type: 'field', id: 'c', tons: 150 }], tos: [] }];
  const s = doubleCropSplit([fld('c', 100, 0, { doubleCrop: true, yieldMode: 'actual' }), fld('a', 100, 3)], moves);
  assert.equal(s.double.yieldTHa, 1.5); assert.equal(s.normal.yieldTHa, 3);
});

console.log('\n=== averages by commodity ===');
const season = (fs) => ({ commodities: [wheat], fields: fs, sales: [], movements: [] });
const years = { 2024: season(fields), 2025: season([fld('a', 100, 4), fld('c', 100, 3, { doubleCrop: true })]), 2026: season([fld('a', 100, 5)]) };
const res = seasonAverages(years, ['2024', '2025', '2026']);
const w = res.commodities[0];
check('each season and the span have the double crop and after fallow yields next to the all-paddocks yield', () => {
  assert.equal(w.hasDouble, true);
  assert.equal(w.seasons['2024'].yieldTHa, 2.75);
  assert.equal(w.seasons['2024'].double.yieldTHa, 2); assert.equal(w.seasons['2024'].normal.yieldTHa, 3);
  assert.equal(w.seasons['2025'].double.yieldTHa, 3); assert.equal(w.seasons['2025'].normal.yieldTHa, 4);
  // 2026 has no double crop: its after fallow yield is all of it, the double crop side is empty
  assert.equal(w.seasons['2026'].double.yieldTHa, 0); assert.equal(w.seasons['2026'].normal.yieldTHa, 5);
  // across the span: double (200 + 300) t over 200 ha = 2.5; after fallow (900 + 400 + 500) t over 500 ha = 3.6; all 2300 / 700
  assert.equal(w.total.double.yieldTHa, 2.5); assert.equal(w.total.normal.yieldTHa, 3.6);
  assert.equal(w.total.yieldTHa, 3.29, 'the crop average is unchanged by the tick');
});
check('a crop with no double-cropped paddock in the seasons picked has no split and its figures are as before', () => {
  const r = seasonAverages({ 2026: season([fld('a', 100, 5)]) }, ['2026']);
  assert.equal(r.commodities[0].hasDouble, false); assert.equal(r.commodities[0].total.yieldTHa, 5);
});
check('the Excel rows carry both yields, and leave them blank for a crop with no double crop', () => {
  const rows = averagesRows(res);
  assert.equal(rows[0].doubleYield, 2); assert.equal(rows[0].normalYield, 3);
  assert.ok(AVERAGES_COLUMNS(true).some((c) => c.label === 'Double crop yield (t/ha)') && AVERAGES_COLUMNS(true).some((c) => c.label === 'After fallow yield (t/ha)'));
  const plain = averagesRows(seasonAverages({ 2026: season([fld('a', 100, 5)]) }, ['2026']));
  assert.equal(plain[0].doubleYield, ''); assert.equal(plain[0].normalYield, '');
});
check('the PDF adds the two yield columns for a crop that has a double crop, and not otherwise', () => {
  assert.ok(text(averagesPdf(res, {})).includes('Double t/ha') && text(averagesPdf(res, {})).includes('Fallow t/ha'));
  assert.ok(!text(averagesPdf(seasonAverages({ 2026: season([fld('a', 100, 5)]) }, ['2026']), {})).includes('Double t/ha'));
});

console.log('\n=== saved with the paddock ===');
check('double crop is saved only once it is ticked, un-ticking reaches the server, and it comes back', () => {
  const FARM = '99999999-9999-9999-9999-999999999999';
  const st = (f) => ({ currentYear: '2026', nextMovementNo: 1, businessDetails: {}, years: { 2026: { commodities: [], fields: [f], sales: [], invoices: [], overheads: {}, storages: [], movements: [] } } });
  const base = { id: 'f1', name: 'North', areaHa: 100, commodityId: null, yieldTHa: 0, yieldMode: 'estimate' };
  assert.ok(!('double_crop' in stateToRows(st(base), FARM).fields[0]), 'a paddock that is not ticked sends no column, so it saves before the database has it');
  const rows = stateToRows(st({ ...base, doubleCrop: true }), FARM);
  assert.equal(rows.fields[0].double_crop, true);
  assert.equal(rowsToState(rows).years['2026'].fields[0].doubleCrop, true);
  assert.equal(stateToRows(st({ ...base, doubleCrop: false, __hasDoubleCrop: true }), FARM).fields[0].double_crop, false, 'un-ticking reaches the server');
});

console.log('\n=== on the screens ===');
check('the paddock form has the tick, Position shows both yields in the crop detail (not on its tile), and the database column is in the paste-in files', () => {
  const p = read('docs/js/views/production.js');
  assert.ok(p.includes('id="doubleCrop"') && p.includes("doubleCrop: !!root.querySelector('#doubleCrop')?.checked"), 'a tick beside the area, saved as true or false');
  const pos = read('docs/js/views/position.js');
  assert.ok(pos.includes('Double crop yield') && pos.includes('After fallow yield'), 'both yields are in the crop detail');
  assert.ok(!pos.includes('<small>Double crop</small>'), 'the tile on the front page keeps just the average yield');
  const av = read('docs/js/views/averages.js');
  assert.ok(av.includes('c.hasDouble') && av.includes('<th>Double</th><th>Fallow</th>'));
  assert.ok(read('docs/js/storage.js').includes('merged.__hasDoubleCrop = true'));
  for (const f of ['supabase/migrations/20261223000000_field_double_crop.sql', 'supabase/paste-into-sql-editor.sql', 'supabase/test-copy/part-4.sql']) assert.ok(read(f).includes('add column if not exists double_crop boolean'), f);
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
