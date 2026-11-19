// Run with:
//   node tests/farmswitches.test.mjs
//
// The switches an owner can turn on to change what a role can see: kept with the farm, off until turned on, applied to the tabs,
// and enforced by the database beside the standard rules.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SWITCHES, readSwitches, withSwitch, switchGroups, switchesForArea } from '../docs/js/farmswitches.js';
import { ACCESS, LEVELS, effectiveAccess } from '../docs/js/helpcontent.js';
import { setFarmSwitches, tabsForRole, routesForRole, landingTabFor, canOpen, canSeeYield, canEditLoads, canDelete, canMarkFinal, canSeeBills } from '../docs/js/nav.js';
import { hubGroups } from '../docs/js/reportshub.js';
import { setFarmSwitches as setStampedSwitches } from '../docs/js/nav.js?v=420';   // the copy the app's own modules import
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
  const sql = read('supabase/migrations/20261209000000_farm_switches.sql') + read('supabase/migrations/20261210000000_farm_switches_two.sql') + read('supabase/migrations/20261212000000_farm_switches_three.sql') + '\n// app only: workerSeesYields workerSeesPosition driverSeesStorage workerSeesSales';
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
  assert.ok(read('docs/js/helpcontent.js').includes("role: 'advisor'") && read('docs/js/views/levelpill.js').includes("advisor: 'Advisor'"));
  assert.ok(read('docs/js/main.js').includes("currentRole === 'advisor'"), 'the screen says it is read only');
});

// ---- the grid: each question sits under an area, and the table shows the farm's own rules --------------------------------

check('every switch sits under an area of the table, and one it needs is another real switch', () => {
  const areas = ACCESS.map((r) => r.area);
  for (const s of SWITCHES) {
    assert.ok(areas.includes(s.area), `${s.key} is under "${s.area}", which is not an area`);
    if (s.needs) assert.ok(SWITCHES.some((o) => o.key === s.needs), `${s.key} needs ${s.needs}`);
  }
  assert.equal(SWITCHES.filter((s) => s.area === 'Loads and tickets').length, switchesForArea('Loads and tickets').length);
  assert.deepEqual(switchesForArea('Nowhere'), []);
});

check('the table for a farm with every switch off is the standard table', () => {
  const eff = effectiveAccess({});
  assert.deepEqual(eff, ACCESS);
  assert.notEqual(eff[0], ACCESS[0], 'new rows: the standard table is never changed');
});

check('a switch changes only the cells it should, and the table agrees with the tab bar', () => {
  const cell = (rows, area, role) => rows.find((r) => r.area === area)[role];
  const eff = effectiveAccess({ workerSeesPosition: true, managerSeesOverheads: true, bookkeeperEditsLoads: true, workersRaiseSprays: true });
  assert.equal(cell(eff, 'Position', 'farm_worker'), 'view');
  assert.equal(cell(eff, 'Overheads', 'manager'), 'view');
  assert.equal(cell(eff, 'Loads and tickets', 'bookkeeper'), 'full');
  assert.equal(cell(eff, 'Spray requests', 'farm_worker'), 'draft');
  assert.equal(cell(eff, 'Position', 'manager'), cell(ACCESS, 'Position', 'manager'), 'other cells stay');
  assert.ok(LEVELS.draft, 'the new level has a name');
  // advisors: loads first, then prices and overheads on top
  assert.equal(cell(effectiveAccess({ advisorSeesPrices: true }), 'Invoices', 'advisor'), 'none', 'prices need loads');
  const adv = effectiveAccess({ advisorSeesLoads: true, advisorSeesPrices: true, advisorSeesOverheads: true });
  for (const a of ['Position', 'Contracts and prices', 'Loads and tickets', 'Reports', 'Invoices', 'Bills', 'Overheads']) assert.equal(cell(adv, a, 'advisor'), 'view', a);
  // the table's Position row for a worker is the tab bar
  for (const sw of [{}, { workerSeesPosition: true }, { advisorSeesLoads: true }]) {
    setFarmSwitches(sw);
    const rows = effectiveAccess(sw);
    for (const role of ['farm_worker', 'advisor']) assert.equal(cell(rows, 'Position', role) !== 'none', tabsForRole(role).includes('position'), `${role} with ${JSON.stringify(sw)}`);
  }
  setFarmSwitches({});
});

check('Settings shows the table for the farm, with the questions under each area; Help shows the same table', () => {
  const v = read('docs/js/views/settingspeople.js');
  assert.ok(v.includes('effectiveAccess(on)') && v.includes('switchesForArea(r.area)') && v.includes('class="area-block"'));
  assert.ok(read('docs/js/views/help.js').includes('effectiveAccess(readSwitches('), 'Help follows the farm');
});

// ---- the third set: a driver's Storage, a worker's Sales, a manager kept from bills -------------------------------------------

check('a driver can be given Storage and a worker Sales, in the usual order of the bar', () => {
  setFarmSwitches({});
  assert.deepEqual(tabsForRole('driver'), ['movement']);
  assert.deepEqual(tabsForRole('farm_worker'), ['production', 'movement', 'storage', 'reports']);
  setFarmSwitches({ driverSeesStorage: true, workerSeesSales: true });
  assert.deepEqual(tabsForRole('driver'), ['movement', 'storage']);
  assert.equal(landingTabFor('driver'), 'movement', 'a driver still opens on loads');
  assert.deepEqual(tabsForRole('farm_worker'), ['production', 'sales', 'movement', 'storage', 'reports']);
  setFarmSwitches({ workerSeesPosition: true, workerSeesSales: true });
  assert.deepEqual(tabsForRole('farm_worker'), ['position', 'production', 'sales', 'movement', 'storage', 'reports']);
  setFarmSwitches({});
});

check('the table agrees with the tab bar for those two, and a manager kept from bills loses both rows', () => {
  const cell = (rows, area, role) => rows.find((r) => r.area === area)[role];
  const sw = { driverSeesStorage: true, workerSeesSales: true, managerHidesBills: true };
  const rows = effectiveAccess(sw);
  assert.equal(cell(rows, 'Storage', 'driver'), 'view');
  assert.equal(cell(rows, 'Contracts and prices', 'farm_worker'), 'view');
  assert.equal(cell(rows, 'Invoices', 'manager'), 'none'); assert.equal(cell(rows, 'Bills', 'manager'), 'none');
  assert.equal(cell(rows, 'Invoices', 'owner'), 'full');
  setFarmSwitches(sw);
  assert.equal(tabsForRole('driver').includes('storage'), cell(rows, 'Storage', 'driver') !== 'none');
  assert.equal(tabsForRole('farm_worker').includes('sales'), cell(rows, 'Contracts and prices', 'farm_worker') !== 'none');
  setFarmSwitches({});
});

check('who is shown invoices and bills follows the farm', () => {
  setFarmSwitches({});
  for (const r of ['owner', 'bookkeeper', 'manager']) assert.equal(canSeeBills(r), true, r);
  for (const r of ['farm_worker', 'driver', 'advisor']) assert.equal(canSeeBills(r), false, r);
  setFarmSwitches({ managerHidesBills: true, advisorSeesLoads: true, advisorSeesPrices: true });
  assert.equal(canSeeBills('manager'), false); assert.equal(canSeeBills('owner'), true); assert.equal(canSeeBills('advisor'), true);
  setFarmSwitches({});
  setStampedSwitches({});
  const ids = (role) => hubGroups({ mode: 'full', role, can: () => true }).flatMap((g) => g.tiles).map((t) => t.id);
  assert.ok(ids('manager').includes('owed') && ids('manager').includes('xero'));
  setStampedSwitches({ managerHidesBills: true });
  assert.ok(!ids('manager').includes('owed') && !ids('manager').includes('xero'), 'no invoice or Xero tile for a manager kept from bills');
  assert.ok(ids('owner').includes('owed'));
  setStampedSwitches({});
  setFarmSwitches({});
});

check('the third migration narrows managers beside the standard rules, and is in the paste-in file', () => {
  const sql = read('supabase/migrations/20261212000000_farm_switches_three.sql');
  assert.ok(sql.includes('invoices_manager_hidden') && sql.includes('payables_manager_hidden') && sql.includes('as restrictive for select') && sql.includes("'managerHidesBills'"));
  assert.ok(!/drop policy if exists (invoices|payables)_(select|insert|update)\b/.test(sql), 'the standard policies are not touched');
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('invoices_manager_hidden'), 'it is in the paste-in file');
  const s2 = read('docs/js/views/sales.js');
  assert.ok(s2.includes('canSeeBills(db.getRole())'), 'a contract shows no Invoices button to a manager kept from bills');
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
