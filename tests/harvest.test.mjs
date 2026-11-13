// Run with:
//   node tests/harvest.test.mjs
//
// Harvest progress: what is in, what is still to come, and the room left in the silos to take it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fieldHarvest, harvestReport, siloSpace, pctText } from '../docs/js/harvest.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

// 100 ha of wheat at an estimated 4 t/ha is 400 t
const wheat = { id: 'w', name: 'Wheat' };
const barley = { id: 'b', name: 'Barley' };
const f = (id, name, commodityId, areaHa, yieldTHa, extra = {}) => ({ id, name, commodityId, areaHa, yieldTHa, ...extra });
const carted = (id, fieldId, tons) => ({ id, froms: [{ type: 'field', id: fieldId, tons }], tos: [{ type: 'silo', id: 's1', tons }] });

console.log('\n=== one field ===');

check('what is in is what has been carted off it; to come is the estimate less that', () => {
  const h = fieldHarvest(f('f1', 'North', 'w', 100, 4), [carted('m1', 'f1', 150), carted('m2', 'f1', 50)]);
  assert.equal(h.estimateT, 400);
  assert.equal(h.inT, 200);
  assert.equal(h.toComeT, 200);
  assert.equal(h.pct, 0.5);
  assert.equal(h.done, false);
});
check('nothing in yet: all of it is to come', () => {
  const h = fieldHarvest(f('f1', 'North', 'w', 100, 4), []);
  assert.equal(h.toComeT, 400);
  assert.equal(h.pct, 0);
});
check('a finished field has nothing to come, whatever its estimate said', () => {
  const h = fieldHarvest(f('f1', 'North', 'w', 100, 4, { harvestDone: true }), [carted('m1', 'f1', 320)]);
  assert.equal(h.toComeT, 0);
  assert.equal(h.pct, 1);
  assert.equal(h.expectedT, 320, 'what it gave is what it was always going to give');
});
check('more in than the estimate: nothing more expected by the estimate, but not finished until said', () => {
  const h = fieldHarvest(f('f1', 'North', 'w', 100, 4), [carted('m1', 'f1', 450)]);
  assert.equal(h.toComeT, 0);
  assert.equal(h.ahead, true);
  assert.equal(h.done, false);
});
check('loads from other fields do not count', () => {
  const h = fieldHarvest(f('f1', 'North', 'w', 100, 4), [carted('m1', 'other', 999)]);
  assert.equal(h.inT, 0);
});
check('a field with no estimate has nothing expected, so no share done', () => {
  const h = fieldHarvest(f('f1', 'North', 'w', 100, 0), []);
  assert.equal(h.pct, 0);
  assert.equal(h.toComeT, 0);
});
check('the yield so far', () => {
  assert.equal(fieldHarvest(f('f1', 'North', 'w', 100, 4), [carted('m1', 'f1', 350)]).yieldSoFar, 3.5);
});

console.log('\n=== the report ===');

const fields = [
  f('f1', 'North', 'w', 100, 4, { harvestDone: true }), f('f2', 'South', 'w', 50, 4), f('f3', 'Dam', 'b', 40, 5), f('f4', 'Odd', null, 10, 2),
];
const moves = [carted('m1', 'f1', 380), carted('m2', 'f2', 100), carted('m3', 'f3', 200)];
const rep = harvestReport([wheat, barley], fields, moves);

check('a group for each commodity, then fields with none', () => {
  assert.deepEqual(rep.groups.map((g) => g.name), ['Wheat', 'Barley', 'No commodity']);
});
check('a commodity\'s totals: tonnes in, to come, and hectares finished and left', () => {
  const w = rep.groups[0].totals;
  assert.equal(w.estimateT, 600);
  assert.equal(w.inT, 480);
  assert.equal(w.toComeT, 100, 'North is finished; South has 200 t estimated, 100 in');
  assert.equal(w.doneHa, 100);
  assert.equal(w.toGoHa, 50);
  assert.equal(w.doneFields, 1);
});
check('the whole farm adds the commodities', () => {
  assert.equal(rep.farm.inT, 680);
  assert.equal(rep.farm.toComeT, 100 + 0 + 20);
  assert.equal(rep.farm.fields, 4);
  assert.equal(rep.farm.areaHa, 200);
});
check('fields are in name order within a commodity', () => {
  assert.deepEqual(rep.groups[0].rows.map((r) => r.field.name), ['North', 'South']);
});
check('no fields, no report', () => {
  assert.deepEqual(harvestReport([wheat], [], []).groups, []);
});
check('the share as a percentage', () => {
  assert.equal(pctText(0.5), '50%');
  assert.equal(pctText(1), '100%');
  assert.equal(pctText(undefined), '0%');
});

console.log('\n=== room in the silos ===');

const silo = (id, name, capacityTons, commodityId, openingStock = 0, extra = {}) => ({ id, name, capacityTons, commodityId, openingStock, ...extra });
const storages = [
  silo('s1', 'Silo 1', 500, 'w', 300),
  silo('s2', 'Silo 2', 400, 'w', 100),
  silo('s3', 'Silo 3', 300, 'b', 50),
  silo('s4', 'Silo 4', 600, 'b', 0),
  silo('s5', 'Silo 5', 200, null, 0),
];
check('room is capacity less what is tracked, under the commodity held', () => {
  const sp = siloSpace(storages, []);
  assert.deepEqual(sp.byCommodity.get('w'), { room: 200 + 300, silos: 2 });
  assert.deepEqual(sp.byCommodity.get('b'), { room: 250, silos: 1 });
});
check('an empty silo has room for any grain, counted once on its own, whatever it last held', () => {
  const sp = siloSpace(storages, []);
  assert.equal(sp.emptyRoom, 600 + 200);
  assert.equal(sp.emptyCount, 2);
});
check('the total is everything free', () => {
  assert.equal(siloSpace(storages, []).totalRoom, 500 + 250 + 800);
});
check('loads in and out change the room', () => {
  const into = [{ id: 'x', tos: [{ type: 'silo', id: 's1', tons: 100 }], froms: [] }];
  assert.equal(siloSpace(storages, into).byCommodity.get('w').room, 400);
});
check('third-party storage, in-transit stores and tallies are not counted', () => {
  const extra = [...storages,
    silo('o1', 'GrainCorp', 9999, null, 0, { offFarm: { operator: 'GrainCorp', opening: [] } }),
    silo('t1', 'In transit', 9999, 'w', 0, { kind: 'tally', unitLabel: 'in transit' })];
  assert.equal(siloSpace(extra, []).totalRoom, 1550);
});
check('a silo with no capacity, or grain but no commodity, is named rather than guessed at', () => {
  const sp = siloSpace([silo('a', 'Silo A', 0, 'w'), silo('b', 'Silo B', 300, null, 80)], []);
  assert.equal(sp.totalRoom, 0);
  assert.deepEqual(sp.notCounted, ['Silo A (no capacity set)', 'Silo B (holds grain, no commodity set)']);
});
check('each silo is listed with its room, most room first', () => {
  const sp = siloSpace(storages, []);
  assert.equal(sp.silos.length, 5);
  assert.equal(sp.silos[0].name, 'Silo 4');
  assert.equal(sp.silos[0].room, 600);
  assert.equal(sp.silos[0].empty, true);
  const s1 = sp.silos.find((s) => s.name === 'Silo 1');
  assert.equal(s1.room, 200);
  assert.equal(s1.stock, 300);
  assert.equal(s1.pct, 0.6);
  for (let i = 1; i < sp.silos.length; i++) assert.ok(sp.silos[i - 1].room >= sp.silos[i].room);
});
check('silos not counted are not in the list', () => {
  const sp = siloSpace([silo('a', 'Silo A', 0, 'w'), silo('b', 'Silo B', 300, null, 80)], []);
  assert.equal(sp.silos.length, 0);
});
check('a full silo has no room, never negative room', () => {
  assert.equal(siloSpace([silo('a', 'A', 100, 'w', 140)], []).byCommodity.get('w').room, 0);
});

console.log('\n=== saving and loading ===');

const FARM = '11111111-1111-1111-1111-111111111111';
const FID = '31313131-3131-3131-3131-313131313131';
const stateOf = (field) => ({
  currentYear: '2026', nextMovementNo: 1, businessDetails: {},
  years: { 2026: { commodities: [], storages: [], sales: [], movements: [], invoices: [], overheads: {}, fields: [{ id: FID, name: 'North', areaHa: 100, ...field }] } },
});
check('finished goes to the server and comes back', () => {
  const rows = stateToRows(stateOf({ harvestDone: true }), FARM);
  assert.equal(rows.fields[0].harvest_done, true);
  assert.equal(rowsToState(rows).years[2026].fields[0].harvestDone, true);
});
check('a paddock not marked sends no such column, so paddocks still save before the database has it', () => {
  assert.ok(!('harvest_done' in stateToRows(stateOf({}), FARM).fields[0]));
});
check('having been marked finished and then un-ticked still sends false, so the change reaches the server', () => {
  const row = stateToRows(stateOf({ harvestDone: false, __hasHarvestDone: true }), FARM).fields[0];
  assert.equal(row.harvest_done, false);
});

console.log('\n=== wired in ===');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
check('Reports has a Harvest view, only for roles that can see yields', () => {
  const src = read('docs/js/views/reports.js');
  assert.match(src, /showYield \? `<button data-view="harvest"/);
  assert.match(src, /paintHarvest\(root\)/);
});
check('the paddock form has the finished box', () => {
  assert.match(read('docs/js/views/production.js'), /id: 'harvestDone'/);
  assert.match(read('docs/js/views/production.js'), /harvestDone: getVal\(root, 'harvestDone'\) === 'yes'/);
});
check('the database column is in the paste-in file', () => {
  assert.match(read('supabase/paste-into-sql-editor.sql'), /harvest_done boolean/);
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
