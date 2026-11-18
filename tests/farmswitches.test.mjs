// Run with:
//   node tests/farmswitches.test.mjs
//
// The switches an owner can turn on to change what a role can see: kept with the farm, off until turned on, applied to the tabs,
// and enforced by the database beside the standard rules.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SWITCHES, readSwitches, withSwitch, switchGroups } from '../docs/js/farmswitches.js';
import { setFarmSwitches, tabsForRole, routesForRole, landingTabFor, canOpen, canSeeYield, canEditLoads, canDelete, canMarkFinal } from '../docs/js/nav.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

check('every switch has a key, a heading, a line and a hint, and the keys are all different', () => {
  for (const s of SWITCHES) assert.ok(s.key && s.role && s.label && s.hint, s.key);
  assert.equal(new Set(SWITCHES.map((s) => s.key)).size, SWITCHES.length);
  assert.deepEqual(switchGroups().map((g) => g.role), ['Managers', 'Workers', 'Drivers', 'Bookkeepers', 'Deleting and weights', 'Advisors']);
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

// ---- the second set: sprays, deleting, final weights, bookkeeper loads, and the Advisor ------------------------------------

check('an advisor starts with paddocks and storage, and gets the rest of the bar only when loads are switched on', () => {
  setFarmSwitches({});
  assert.deepEqual(tabsForRole('advisor'), ['production', 'storage']);
  assert.equal(canOpen('advisor', 'settings'), false, 'an advisor does not get Settings');
  assert.equal(canOpen('advisor', 'account'), true, 'but can always sign out');
  assert.equal(canSeeYield('advisor'), false);
  setFarmSwitches({ advisorSeesLoads: true });
  assert.deepEqual(tabsForRole('advisor'), ['position', 'production', 'sales', 'movement', 'storage', 'reports']);
  assert.equal(canSeeYield('advisor'), true);
  assert.equal(landingTabFor('advisor'), 'position');
  setFarmSwitches({});
});

check('who may add loads, delete, and mark a weight final follows the farm\'s switches', () => {
  setFarmSwitches({});
  assert.equal(canEditLoads('bookkeeper'), false);
  for (const r of ['owner', 'manager', 'farm_worker', 'driver']) assert.equal(canEditLoads(r), true, r);
  for (const r of ['advisor', 'support']) assert.equal(canEditLoads(r), false, r);
  for (const r of ['owner', 'manager', 'farm_worker', 'driver', 'bookkeeper']) { assert.equal(canDelete(r), true, r); assert.equal(canMarkFinal(r), true, r); }
  setFarmSwitches({ bookkeeperEditsLoads: true, deleteOwnerManagerOnly: true, finalWeightsManagersOnly: true });
  assert.equal(canEditLoads('bookkeeper'), true);
  assert.equal(canEditLoads('advisor'), false, 'a switch never lets an advisor write');
  for (const r of ['farm_worker', 'driver', 'bookkeeper']) { assert.equal(canDelete(r), false, r); assert.equal(canMarkFinal(r), false, r); }
  for (const r of ['owner', 'manager']) { assert.equal(canDelete(r), true, r); assert.equal(canMarkFinal(r), true, r); }
  setFarmSwitches({});
});

check('what a role may send follows the switches, and an advisor sends nothing', () => {
  const src = read('docs/js/sync.js');
  assert.ok(src.includes('advisor: [],'), 'advisor writes nothing');
  assert.ok(src.includes("role === 'bookkeeper' && farmSwitch('bookkeeperEditsLoads')") && src.includes("role === 'farm_worker' && farmSwitch('workersRaiseSprays')"));
  assert.ok(src.includes('const tables = writableTables(role);'));
  assert.ok(read('docs/js/storage.js').includes("role === 'support' || role === 'advisor'"), 'nothing an advisor changes on screen is queued');
});

check('a worker can write a spray request only on a farm that switched it on, and only a manager sends it', () => {
  const sp = read('docs/js/views/spray.js');
  assert.ok(sp.includes("role === 'farm_worker' && farmSwitch('workersRaiseSprays')"));
  assert.ok(sp.includes('canSendSpray'), 'sending is for an owner or manager');
  assert.ok(sp.includes('A manager looks after it'), 'a sent request is not opened by a worker');
});

check('the screens follow: loads are locked when the role cannot change them, delete is hidden, Final is held back', () => {
  const mv = read('docs/js/views/movements.js');
  assert.ok(mv.includes('canEditLoads(db.getRole())') && mv.includes('canDelete(db.getRole())') && mv.includes('canMarkFinal(db.getRole())'));
  assert.ok(mv.includes('This weight is final. An owner or manager changes it.'));
  assert.ok(read('docs/js/views/sales.js').includes('canDelete(db.getRole())'), 'a contract too');
});

check('every switch the screen offers is one the database knows', () => {
  const sql = read('supabase/migrations/20261209000000_farm_switches.sql') + read('supabase/migrations/20261210000000_farm_switches_two.sql') + '\n// app only: workerSeesYields workerSeesPosition';
  for (const s of SWITCHES) assert.ok(sql.includes(s.key), `${s.key} is in neither migration`);
});

check('the second migration adds the Advisor and each switch beside the standard rules, and is in the paste-in file', () => {
  const sql = read('supabase/migrations/20261210000000_farm_switches_two.sql');
  assert.ok(sql.includes("'driver', 'support', 'advisor'") && sql.includes("'driver', 'advisor'"), 'the Advisor is an allowed role for a membership and an invitation');
  for (const w of ['spray_jobs_worker_insert', 'movements_bookkeeper_update', 'movements_delete_switch', 'movements_final_weight_update', 'sale_terms_advisor_read', 'overheads_advisor_read', 'movements_advisor_loads']) assert.ok(sql.includes(w), w);
  assert.ok(sql.includes('as restrictive for update') && sql.includes('as restrictive for insert') && sql.includes('as restrictive for select'));
  assert.ok(sql.includes("p_table in ('movements', 'sales', 'sale_terms') and not app_may_delete(v_farm)"), 'the delete function says the same');
  assert.ok(!/drop policy if exists (movements|sales|sale_terms|spray_jobs)_(select|insert|update)\b/.test(sql), 'the standard policies are not touched');
  const paste = read('supabase/paste-into-sql-editor.sql');
  assert.ok(paste.includes('function app_may_delete(') && paste.includes('movements_advisor_loads'), 'it is in the paste-in file');
});

check('the people list can invite an advisor, and the account and help pages name them', () => {
  assert.ok(read('docs/js/invites.js').includes("value: 'advisor'"));
  assert.ok(read('docs/js/views/account.js').includes("advisor: 'Advisor (read only)'"));
  assert.ok(read('docs/js/helpcontent.js').includes("role: 'advisor'") && read('docs/js/views/help.js').includes("advisor: 'Advisor'"));
  assert.ok(read('docs/js/main.js').includes("currentRole === 'advisor'"), 'the screen says it is read only');
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
