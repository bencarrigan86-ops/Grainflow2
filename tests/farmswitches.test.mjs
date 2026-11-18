// Run with:
//   node tests/farmswitches.test.mjs
//
// The switches an owner can turn on to change what a role can see: kept with the farm, off until turned on, applied to the tabs,
// and enforced by the database beside the standard rules.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SWITCHES, readSwitches, withSwitch, switchGroups } from '../docs/js/farmswitches.js';
import { setFarmSwitches, tabsForRole, routesForRole, landingTabFor, canOpen, canSeeYield } from '../docs/js/nav.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

check('every switch has a key, a heading, a line and a hint, and the keys are all different', () => {
  for (const s of SWITCHES) assert.ok(s.key && s.role && s.label && s.hint, s.key);
  assert.equal(new Set(SWITCHES.map((s) => s.key)).size, SWITCHES.length);
  assert.deepEqual(switchGroups().map((g) => g.role), ['Managers', 'Workers', 'Drivers']);
});

check('only a saved true is on; anything else, and anything unknown, is off', () => {
  assert.deepEqual(readSwitches(null), {});
  assert.deepEqual(readSwitches([]), {});
  assert.deepEqual(readSwitches({ managerSeesPrices: 'yes', workerSeesYields: true, nonsense: true }), { managerSeesPrices: false, workerSeesYields: true });
});

check('turning a switch off keeps it as an explicit false, so the change reaches the server', () => {
  const on = withSwitch({}, 'managerSeesPrices', true);
  assert.deepEqual(on, { managerSeesPrices: true });
  assert.deepEqual(withSwitch(on, 'managerSeesPrices', false), { managerSeesPrices: false });
  assert.deepEqual(withSwitch(on, 'notASwitch', true), { managerSeesPrices: true });
});

check('with every switch off, the tabs are the standard ones', () => {
  setFarmSwitches({});
  assert.deepEqual(tabsForRole('farm_worker'), ['production', 'movement', 'storage', 'reports']);
  assert.equal(canOpen('farm_worker', 'position'), false);
  assert.equal(canSeeYield('farm_worker'), false);
  assert.equal(landingTabFor('farm_worker'), 'production');
});

check('workers see Position when the farm switches it on, first in the bar, and then see yields too', () => {
  setFarmSwitches({ workerSeesPosition: true });
  assert.deepEqual(tabsForRole('farm_worker'), ['position', 'production', 'movement', 'storage', 'reports']);
  assert.ok(canOpen('farm_worker', 'position') && routesForRole('farm_worker').includes('position'));
  assert.equal(canSeeYield('farm_worker'), true);
  assert.equal(canOpen('driver', 'position'), false, 'no other role is changed');
  assert.deepEqual(tabsForRole('driver'), ['movement']);
});

check('workers can see yields without the Position tab', () => {
  setFarmSwitches({ workerSeesYields: true });
  assert.equal(canSeeYield('farm_worker'), true);
  assert.equal(canOpen('farm_worker', 'position'), false);
  assert.equal(canSeeYield('driver'), false);
  setFarmSwitches({});
});

check('the switches are saved with the farm, only once there are any, and come back', () => {
  const FARM = '99999999-9999-9999-9999-999999999999';
  const st = (b) => ({ currentYear: '2026', nextMovementNo: 1, businessDetails: b, years: { 2026: { commodities: [], fields: [], sales: [], invoices: [], overheads: {}, storages: [], movements: [] } } });
  assert.ok(!('switches' in stateToRows(st({}), FARM).farms[0]), 'a farm with none sends no column, so it saves before the database has it');
  const rows = stateToRows(st({ switches: { managerSeesPrices: true } }), FARM);
  assert.deepEqual(rows.farms[0].switches, { managerSeesPrices: true });
  assert.deepEqual(rowsToState({ ...rows, farms: [{ ...rows.farms[0] }] }).businessDetails.switches, { managerSeesPrices: true });
  assert.ok('switches' in stateToRows(st({ switches: {}, __hasSwitches: true }), FARM).farms[0], 'having had some, an empty list still reaches the server');
});

check('the database keeps the standard rules and adds each switch beside them', () => {
  const sql = read('supabase/migrations/20261209000000_farm_switches.sql');
  assert.ok(sql.includes('add column if not exists switches jsonb') && sql.includes('function app_switch('));
  for (const w of ['sale_terms_manager_switch', 'overheads_manager_switch', 'movements_driver_own_only', 'movement_legs_driver_own_only', 'movement_photos_driver_own_only']) assert.ok(sql.includes(w), w);
  assert.ok(sql.includes('as restrictive for select'), 'a driver restriction narrows, it does not add');
  for (const k of ['managerSeesPrices', 'managerSeesOverheads', 'driverOwnLoadsOnly']) assert.ok(sql.includes(`'${k}'`), k);
  assert.ok(!/drop policy if exists (sale_terms|overheads|movements)_(select|insert|update)\b/.test(sql), 'the standard policies are not touched');
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('function app_switch('), 'it is in the paste-in file');
});

check('Settings has the switches, in a fold under the people, saved with the farm details', () => {
  const v = read('docs/js/views/settingspeople.js');
  assert.ok(v.includes('id="switch-fold"') && v.includes('data-switch') && v.includes('withSwitch(') && v.includes('updateBusinessDetails({ switches'));
  assert.ok(read('docs/js/storage.js').includes('setFarmSwitches(readSwitches('), 'the tabs follow the saved switches');
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
