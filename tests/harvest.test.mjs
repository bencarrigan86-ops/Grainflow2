// Run with:
//   node tests/harvest.test.mjs
//
// Harvest progress: what is in, what is still to come, and the room left in the silos to take it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fieldHarvest, harvestReport, siloSpace, roomSplit, pctText } from '../docs/js/harvest.js';
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

console.log('\n=== part harvested: hectares still to cut ===');

check('500 t in and 20 ha still to cut: to come is those hectares at the estimated yield, on top of what is in', () => {
  const h = fieldHarvest(f('f1', 'North', 'w', 100, 4, { harvestHaLeft: 20 }), [carted('m1', 'f1', 500)]);
  assert.equal(h.inT, 500);
  assert.equal(h.toComeT, 80);
  assert.equal(h.expectedT, 580);
  assert.equal(h.haLeft, 20);
  assert.equal(h.doneHa, 80);
  assert.equal(h.ahead, false, 'over the whole-field estimate does not matter once the hectares left are said');
  assert.ok(Math.abs(h.pct - 500 / 580) < 1e-9);
});
check('blank means not said: the estimate less the tickets, as before', () => {
  for (const blank of [undefined, null, '']) {
    const h = fieldHarvest(f('f1', 'North', 'w', 100, 4, { harvestHaLeft: blank }), [carted('m1', 'f1', 150)]);
    assert.equal(h.toComeT, 250);
    assert.equal(h.haLeft, null);
    assert.equal(h.doneHa, 0);
  }
});
check('none left to cut is a number, not blank: nothing more to come, though not marked finished', () => {
  const h = fieldHarvest(f('f1', 'North', 'w', 100, 4, { harvestHaLeft: 0 }), [carted('m1', 'f1', 300)]);
  assert.equal(h.toComeT, 0);
  assert.equal(h.doneHa, 100);
  assert.equal(h.done, false);
});
check('finished wins over hectares left; more left than the paddock has is capped at its area', () => {
  assert.equal(fieldHarvest(f('f1', 'N', 'w', 100, 4, { harvestDone: true, harvestHaLeft: 20 }), []).toComeT, 0);
  assert.equal(fieldHarvest(f('f1', 'N', 'w', 100, 4, { harvestHaLeft: 500 }), []).toComeT, 400);
});
check('hectares part cut count in the commodity total of hectares done', () => {
  const r = harvestReport([wheat], [f('a', 'A', 'w', 100, 4, { harvestHaLeft: 20 }), f('b', 'B', 'w', 50, 4, { harvestDone: true })], []);
  assert.equal(r.groups[0].totals.doneHa, 130);
  assert.equal(r.groups[0].totals.toGoHa, 20);
  assert.equal(r.groups[0].totals.doneFields, 1);
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
check('silos with less room than the minimum are left out of the list and the totals, and said so', () => {
  const small = [silo('a', 'A', 500, 'w', 495), silo('b', 'B', 500, 'w', 300), silo('c', 'C', 100, null, 0)];
  const all = siloSpace(small, []);
  assert.equal(all.totalRoom, 5 + 200 + 100);
  const sp = siloSpace(small, [], { minRoom: 20 });
  assert.deepEqual(sp.silos.map((s) => s.name), ['B', 'C']);
  assert.equal(sp.totalRoom, 300);
  assert.equal(sp.byCommodity.get('w').silos, 1);
  assert.deepEqual(sp.tooSmall, { count: 1, room: 5 });
});
check('exactly the minimum is kept; a full silo goes with any minimum above nothing', () => {
  const sp = siloSpace([silo('a', 'A', 100, 'w', 80), silo('b', 'B', 100, 'w', 100)], [], { minRoom: 20 });
  assert.deepEqual(sp.silos.map((s) => s.name), ['A']);
  assert.equal(sp.tooSmall.count, 1);
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

check('hectares left goes to the server and comes back; blank sends nothing; clearing it sends null', () => {
  const rows = stateToRows(stateOf({ harvestHaLeft: 20 }), FARM);
  assert.equal(rows.fields[0].harvest_ha_left, 20);
  assert.equal(rowsToState(rows).years[2026].fields[0].harvestHaLeft, 20);
  assert.ok(!('harvest_ha_left' in stateToRows(stateOf({}), FARM).fields[0]));
  assert.equal(stateToRows(stateOf({ harvestHaLeft: null, __hasHarvestHaLeft: true }), FARM).fields[0].harvest_ha_left, null);
});

console.log('\n=== wired in ===');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
check('Reports has a Harvest view for every role, and a role that is not shown yields gets hectares and silo room with no tonnes', () => {
  const src = read('docs/js/views/reports.js');
  assert.match(src, /<button data-view="harvest"/);
  assert.doesNotMatch(src, /showYield \? `<button data-view="harvest"/);
  assert.match(src, /paintHarvest\(root, showYield\)/);
  const noYield = src.slice(src.indexOf('function harvestNoYieldHtml'), src.indexOf('function paintYield'));
  assert.ok(noYield.length > 500, 'no version without yields');
  for (const bad of ['estimateT', 'inT', 'toComeT', 'yieldSoFar', 'Est t', 'to come', 'Harvested']) assert.ok(!noYield.includes(bad), `the no-yield harvest report shows ${bad}`);
  assert.ok(noYield.includes('doneHa') && noYield.includes('space.totalRoom'));
});
check('the paddock form has the finished box', () => {
  assert.match(read('docs/js/views/production.js'), /id: 'harvestDone'/);
  assert.match(read('docs/js/views/production.js'), /harvestDone: getVal\(root, 'harvestDone'\) === 'yes'/);
});
check('the database column is in the paste-in file', () => {
  assert.match(read('supabase/paste-into-sql-editor.sql'), /harvest_done boolean/);
  assert.match(read('supabase/paste-into-sql-editor.sql'), /harvest_ha_left numeric/);
  assert.match(read('docs/js/views/production.js'), /id: 'harvestHaLeft'/);
});

console.log('\n=== room in silos, crop by crop ===');

const roomSilo = (id, name, commodityId, room, empty = false) => ({ id, name, commodityId, room, empty, stock: 0, capacity: room, pct: 0 });
const sp = (byCommodity, emptyRoom = 0, silos = []) => ({ byCommodity: new Map(byCommodity), emptyRoom, silos });
const grp = (id, name, toComeT, toGoHa) => ({ id, name, totals: { toComeT, toGoHa } });

check('room in silos of a crop with nothing left to cut is not counted towards what is still to come', () => {
  const split = roomSplit(
    sp([['w', { room: 250, silos: 3 }], ['b', { room: 100, silos: 1 }], ['c', { room: 200, silos: 2 }]], 50),
    [grp('w', 'Wheat', 400, 80), grp('b', 'Barley', 0, 0), grp('c', 'Chick peas', 150, 40)],
  );
  const by = Object.fromEntries(split.rows.map((r) => [r.name, r]));
  assert.equal(by.Wheat.short, 150);
  assert.equal(by.Barley.finished, true);
  assert.equal(by.Barley.unusable, 100, 'all of the barley room is no use with no barley left');
  assert.equal(by['Chick peas'].unusable, 50);
  assert.equal(split.shortfall, 150);
  assert.equal(split.unusable, 150);
  assert.equal(split.margin, 50 - 150, 'the empty silos have to cover wheat short by 150');
  assert.deepEqual(split.rows.map((r) => r.name), ['Wheat', 'Chick peas', 'Barley'], 'most room first');
});

check('a crop with no silo holding it, and a paddock with no commodity, are short until empty silos are counted', () => {
  const split = roomSplit(sp([], 300), [grp('w', 'Wheat', 120, 30), grp(null, 'No commodity', 40, 10)]);
  assert.equal(split.shortfall, 160);
  assert.equal(split.margin, 140);
  assert.equal(split.rows.length, 2);
});

check('the sums agree: room left less the room that cannot help less what is still to come is the margin', () => {
  const split = roomSplit(sp([['w', { room: 100, silos: 1 }]], 20), [grp('w', 'Wheat', 60, 10), grp('o', 'Oats', 0, 0)]);
  assert.equal(split.rows.length, 1);
  assert.equal(split.margin, 20);
  assert.equal(120 - split.unusable - 60, split.margin);
});

check('each crop lists its own silos under it, and the empty ones are listed apart', () => {
  const silos = [roomSilo('a', 'Silo 1', 'w', 90), roomSilo('b', 'Silo 2', 'w', 160), roomSilo('c', 'Silo 3', 'b', 100), roomSilo('d', 'Silo 4', null, 40, true)];
  const split = roomSplit(sp([['w', { room: 250, silos: 2 }], ['b', { room: 100, silos: 1 }]], 40, silos), [grp('w', 'Wheat', 100, 20), grp('b', 'Barley', 0, 0)]);
  assert.deepEqual(split.rows.find((r) => r.name === 'Wheat').list.map((x) => x.name), ['Silo 1', 'Silo 2']);
  assert.deepEqual(split.rows.find((r) => r.name === 'Barley').list.map((x) => x.name), ['Silo 3']);
  assert.deepEqual(split.empty.map((x) => x.name), ['Silo 4']);
});

check('the screen groups the silos under a heading for each crop, with the leave-out box at the top of the room section', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../docs/js/views/reports.js'), 'utf8');
  assert.equal(src.split('${roomBySilo(split, space, {').length - 1, 2, 'both versions of the report');
  assert.equal(src.split('${minRoomRow(minRoom)}').length - 1, 2);
  assert.ok(src.indexOf('${minRoomRow(minRoom)}') < src.indexOf("fold('room'"), 'the box is above the room section');
  assert.ok(!src.includes('Each silo'), 'no flat list of silos any more');
  assert.equal(src.split('${spaceAsRow(space, assumeOptions, assume, pick)}').length - 1, 2, 'the empty-silo commodity choice is up with the empty silos total in both versions');
});

console.log('\n=== hectares left with a yield of their own ===');

check('the hectares left at their own yield: 20 ha at 3 t/ha is 60 t to come, not 80 at the paddock estimate of 4', () => {
  const h = fieldHarvest(f('f1', 'North', 'w', 100, 4, { harvestHaLeft: 20, harvestLeftYield: 3 }), [carted('m1', 'f1', 500)]);
  assert.equal(h.toComeT, 60);
  assert.equal(h.expectedT, 560);
  assert.equal(h.leftYield, 3);
});

check('blank, zero or nothing set keeps the paddock estimate; with no hectares left it is not used at all', () => {
  for (const blank of [undefined, null, '', 0]) {
    assert.equal(fieldHarvest(f('f1', 'N', 'w', 100, 4, { harvestHaLeft: 20, harvestLeftYield: blank }), []).toComeT, 80);
  }
  assert.equal(fieldHarvest(f('f1', 'N', 'w', 100, 4, { harvestLeftYield: 9 }), [carted('m1', 'f1', 150)]).toComeT, 250, 'estimate less the tickets');
  assert.equal(fieldHarvest(f('f1', 'N', 'w', 100, 4, { harvestDone: true, harvestHaLeft: 20, harvestLeftYield: 9 }), []).toComeT, 0);
});

check('the yield for the hectares left goes to the server and comes back; blank sends nothing; clearing it sends null', () => {
  const rows = stateToRows(stateOf({ harvestHaLeft: 20, harvestLeftYield: 3.5 }), FARM);
  assert.equal(rows.fields[0].harvest_left_yield, 3.5);
  assert.equal(rowsToState(rows).years[2026].fields[0].harvestLeftYield, 3.5);
  assert.ok(!('harvest_left_yield' in stateToRows(stateOf({}), FARM).fields[0]));
  assert.equal(stateToRows(stateOf({ harvestLeftYield: null, __hasHarvestLeftYield: true }), FARM).fields[0].harvest_left_yield, null);
});

check('the paddock form, the save, the CSV and the SQL all have it', () => {
  const prod = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../docs/js/views/production.js'), 'utf8');
  assert.ok(prod.includes("id: 'harvestLeftYield'") && prod.includes("harvestLeftYield: String(getVal(root, 'harvestLeftYield')"));
  assert.ok(prod.includes('id="cut-so-far"') && prod.includes('Cut so far:'), 'what the cut part is yielding, to go by');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  assert.ok(readFileSync(join(root, 'docs/js/views/settings.js'), 'utf8').includes('Yield for hectares left (t/ha)'));
  assert.ok(readFileSync(join(root, 'supabase/paste-into-sql-editor.sql'), 'utf8').includes('add column if not exists harvest_left_yield numeric'));
  assert.ok(readFileSync(join(root, 'supabase/migrations/20261118970000_harvest_left_yield.sql'), 'utf8').includes('harvest_left_yield'));
});

console.log('\n=== finished paddocks tucked away ===');

check('the report shows only the paddocks still being harvested unless asked, keeps them all in the Total, and remembers the choice', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../docs/js/views/reports.js'), 'utf8');
  assert.equal(src.split('shownRows(g, showDone).map(').length - 1, 2, 'the table in both versions of the report');
  assert.equal(src.split('${doneToggle(g, showDone)}').length - 1, 2, 'a toggle in both versions of the report');
  assert.ok(src.includes('data-show-done') && src.includes('saveShowDone(key, !loadShowDone().has(key))'));
  assert.ok(src.includes('rows.filter((r) => !r.done)'.replace('rows', 'g.rows')));
  const sf = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../docs/js/spacefor.js'), 'utf8');
  assert.ok(sf.includes('export function loadShowDone') && sf.includes('export function saveShowDone'));
});

check('each crop heading carries its space: room less what is still to come, negative when short', () => {
  const split = roomSplit(
    sp([['w', { room: 250, silos: 3 }], ['b', { room: 100, silos: 1 }]], 0),
    [grp('w', 'Wheat', 270, 80), grp('b', 'Barley', 0, 0)],
  );
  const by = Object.fromEntries(split.rows.map((r) => [r.name, r]));
  assert.equal(by.Wheat.space, -20);
  assert.equal(by.Barley.space, 100, 'nothing to come: all of its room is space (and flagged as not needed on screen)');
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../docs/js/views/reports.js'), 'utf8');
  assert.ok(src.includes('Space ${signedT(c.space, t1)}') && src.includes('Room ${t1(c.room)} t − to come ${t1(c.toComeT)} t'));
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
