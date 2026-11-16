// Run with:
//   node tests/commoditylist.test.mjs
//
// The farm's own order for its commodities: one list, kept by commodity name, that every commodity table and group follows.
// With no list the order is automatic (the most tonnes first). A commodity not on the list follows the listed ones.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// The app's own modules import this one with the build stamp on the end, so it is imported that way here too: the list is
// remembered inside the module, and a bare import would be a second copy that the sorts never see.
import { APP_VERSION } from '../docs/js/version.js';
const { setCommodityOrder, hasCommodityOrder, commoditySort, orderedNames, moveName } = await import(`../docs/js/commodityorder.js?v=${APP_VERSION.split('.').pop()}`);
import { position, groupFieldsByCommodity } from '../docs/js/derived.js';
import { harvestReport } from '../docs/js/harvest.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
  setCommodityOrder([]);   // every check starts from the automatic order
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const rows = () => [{ name: 'Oats', t: 10 }, { name: 'Wheat', t: 900 }, { name: 'Barley', t: 10 }, { name: 'Canola', t: 400 }];
const names = (list) => list.map((r) => r.name);

check('with no list it is biggest first, as before', () => {
  assert.equal(hasCommodityOrder(), false);
  assert.deepEqual(names(rows().sort(commoditySort((r) => r.t))), ['Wheat', 'Canola', 'Barley', 'Oats']);
});

check('with a list the commodities follow it, whatever their volume', () => {
  setCommodityOrder(['Canola', 'Oats', 'Wheat', 'Barley']);
  assert.equal(hasCommodityOrder(), true);
  assert.deepEqual(names(rows().sort(commoditySort((r) => r.t))), ['Canola', 'Oats', 'Wheat', 'Barley']);
});

check('one not on the list follows the listed ones, the biggest first', () => {
  setCommodityOrder(['Oats', 'Canola']);
  assert.deepEqual(names(rows().sort(commoditySort((r) => r.t))), ['Oats', 'Canola', 'Wheat', 'Barley']);
});

check('case and stray spaces do not matter, and a repeated name counts once', () => {
  setCommodityOrder(['  canola ', 'WHEAT', 'wheat', '', null]);
  assert.deepEqual(names(rows().sort(commoditySort((r) => r.t))), ['Canola', 'Wheat', 'Barley', 'Oats']);
});

check('anything that is not a list means automatic', () => {
  setCommodityOrder(undefined); assert.equal(hasCommodityOrder(), false);
  setCommodityOrder('Wheat'); assert.equal(hasCommodityOrder(), false);
  setCommodityOrder(null); assert.equal(hasCommodityOrder(), false);
});

const commodities = [{ id: 'o', name: 'Oats' }, { id: 'w', name: 'Wheat' }, { id: 'c', name: 'Canola' }];
const sales = [
  { id: 's1', commodityId: 'o', tons: 50, price: 300 },
  { id: 's2', commodityId: 'w', tons: 900, price: 400 },
  { id: 's3', commodityId: 'c', tons: 300, price: 700 },
];
const fields = [
  { id: 'f1', name: 'North', commodityId: 'o', areaHa: 10, yieldMode: 'estimate', yieldTHa: 2 },
  { id: 'f2', name: 'South', commodityId: 'w', areaHa: 100, yieldMode: 'estimate', yieldTHa: 4 },
  { id: 'f3', name: 'Back', commodityId: 'c', areaHa: 50, yieldMode: 'estimate', yieldTHa: 2 },
  { id: 'f4', name: 'Loose', commodityId: null, areaHa: 5 },
];

check('the position, the paddock groups and the harvest report all follow the list', () => {
  setCommodityOrder(['Oats', 'Canola', 'Wheat']);
  assert.deepEqual(position(commodities, [], sales, []).map((r) => r.commodity.name), ['Oats', 'Canola', 'Wheat']);
  assert.deepEqual(groupFieldsByCommodity(commodities, fields, []).map((g) => g.name), ['Oats', 'Canola', 'Wheat', 'No commodity']);
  assert.deepEqual(harvestReport(commodities, fields, []).groups.map((g) => g.name), ['Oats', 'Canola', 'Wheat', 'No commodity']);
});

check('the same screens go back to biggest first when the list is cleared', () => {
  setCommodityOrder(['Oats', 'Canola', 'Wheat']);
  setCommodityOrder([]);
  assert.deepEqual(position(commodities, [], sales, []).map((r) => r.commodity.name), ['Wheat', 'Canola', 'Oats']);
  assert.deepEqual(groupFieldsByCommodity(commodities, fields, []).map((g) => g.name), ['Wheat', 'Canola', 'Oats', 'No commodity']);
});

check('the settings list: the saved order first, then the rest as they come; names that are gone are dropped', () => {
  assert.deepEqual(orderedNames(['Canola', 'Gone', 'oats'], ['Wheat', 'Oats', 'Canola']), ['Canola', 'Oats', 'Wheat']);
  assert.deepEqual(orderedNames([], ['Wheat', 'Oats']), ['Wheat', 'Oats']);
  assert.deepEqual(orderedNames(undefined, ['Wheat']), ['Wheat']);
});

check('moving one step: up, down, and not off either end', () => {
  const l = ['A', 'B', 'C'];
  assert.deepEqual(moveName(l, 1, -1), ['B', 'A', 'C']);
  assert.deepEqual(moveName(l, 1, 1), ['A', 'C', 'B']);
  assert.deepEqual(moveName(l, 0, -1), l);
  assert.deepEqual(moveName(l, 2, 1), l);
  assert.deepEqual(moveName(l, 5, 1), l);
  assert.deepEqual(l, ['A', 'B', 'C'], 'the list given is not changed');
});

const FARM_ID = '99999999-9999-9999-9999-999999999999';
const farmState = (b) => ({ currentYear: '2026', nextMovementNo: 1, businessDetails: b, years: { 2026: { commodities: [], fields: [], storages: [], sales: [], movements: [], overheads: {}, invoices: [], payables: [] } } });

check('a farm with no list sends no column, so one without the column is not upset', () => {
  assert.ok(!('commodity_order' in stateToRows(farmState({ farmName: 'X' }), FARM_ID).farms[0]));
});

check('the list is sent and comes back; clearing it after it was set still reaches the server', () => {
  const rows1 = stateToRows(farmState({ farmName: 'X', commodityOrder: ['Canola', 'Wheat'] }), FARM_ID);
  assert.deepEqual(rows1.farms[0].commodity_order, ['Canola', 'Wheat']);
  const back = rowsToState(rows1).businessDetails;
  assert.deepEqual(back.commodityOrder, ['Canola', 'Wheat']);
  assert.equal(back.__hasCommodityOrder, true);
  const cleared = stateToRows(farmState({ farmName: 'X', commodityOrder: [], __hasCommodityOrder: true }), FARM_ID);
  assert.deepEqual(cleared.farms[0].commodity_order, []);
  assert.deepEqual(rowsToState(cleared).businessDetails.commodityOrder, []);
});

check('a farm row with no column leaves the order automatic', () => {
  const rows2 = stateToRows(farmState({ farmName: 'X' }), FARM_ID);
  assert.equal(rowsToState(rows2).businessDetails.commodityOrder, undefined);
});

check('it is wired: the data hands the list to the sorts, Settings has the card, and the SQL adds the column', () => {
  const st = read('docs/js/storage.js');
  assert.ok(st.includes('const shareOrder = () => setCommodityOrder(data.businessDetails?.commodityOrder)'));
  assert.ok((st.match(/shareOrder\(\)/g) || []).length >= 7, 'after every swap of the data and every change to the details');
  assert.ok(st.includes('data.businessDetails.__hasCommodityOrder = true'));
  const se = read('docs/js/views/settings.js');
  assert.ok(se.includes('id="order-card"') && se.includes('data-order-move') && se.includes('id="order-auto"'));
  assert.ok(se.includes("db.getRole() === 'owner' ? commodityOrderCard(db.get(), business)"), 'the owner sets it; the server only lets the owner change the farm');
  assert.ok(read('docs/js/derived.js').includes('export const bigFirst = commoditySort;'));
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('add column if not exists commodity_order jsonb'));
  assert.ok(read('supabase/migrations/20261118500000_commodity_order.sql').includes('alter table farms'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
