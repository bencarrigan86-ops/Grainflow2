// Run with:
//   node tests/accesslevels.test.mjs
//
// What an owner can take away from a role, area by area: kept with the farm, only ever less than the standard rules give, applied to
// the tabs and the screens, left out of what a phone sends, and enforced by the database beside the standard policies.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  LEVEL_ROLES, LEVEL_AREAS, LEVEL_TABLES, SCREEN_AREAS, AREA_TAB, readLevels, withLevel, withSwitch, readSwitches, narrowTo, levelChoices,
} from '../docs/js/farmswitches.js';
import { ACCESS, effectiveAccess } from '../docs/js/helpcontent.js';
import {
  setFarmSwitches, setFarmLevels, tabsForRole, landingTabFor, canOpen, canSeeOrders, canSeeOverheads, canSeePrices, canSeeBills, canEditLoads,
  canChangeProduction, canSeeArea, canChangeArea,
} from '../docs/js/nav.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const reset = () => { setFarmSwitches({}); setFarmLevels({}); };

console.log('\n=== the saved choices ===');
check('only real areas, roles and levels are kept; tonnes is a contracts choice only', () => {
  assert.deepEqual(readLevels(null), {});
  assert.deepEqual(readLevels({ levels: { loads: { driver: 'none', owner: 'none', manager: 'sideways' }, nonsense: { driver: 'none' }, production: { advisor: 'tonnes' }, contracts: { manager: 'tonnes' } } }),
    { loads: { driver: 'none' }, contracts: { manager: 'tonnes' } });
});
check('a choice is added, changed and put back, and the switches ride along untouched', () => {
  const a = withLevel({ managerSeesPrices: true }, 'loads', 'bookkeeper', 'view');
  assert.deepEqual(a, { managerSeesPrices: true, levels: { loads: { bookkeeper: 'view' } } });
  assert.deepEqual(withSwitch(a, 'workerSeesYields', true), { managerSeesPrices: true, workerSeesYields: true, levels: { loads: { bookkeeper: 'view' } } });
  assert.deepEqual(withLevel(a, 'loads', 'bookkeeper', null), { managerSeesPrices: true });
  assert.deepEqual(withLevel({}, 'loads', 'owner', 'none'), {}, 'the owner is never held back');
  assert.deepEqual(readSwitches(a), { managerSeesPrices: true }, 'the switches do not see the choices');
});
check('nothing saved leaves the table as it was', () => {
  assert.deepEqual(effectiveAccess({}, {}), effectiveAccess({}));
  assert.deepEqual(effectiveAccess({}).map((r) => r.area), ACCESS.map((r) => r.area));
});

console.log('\n=== only ever less ===');
check('a choice below the cell takes effect; one at or above it does nothing', () => {
  assert.equal(narrowTo('full', 'view'), 'view');
  assert.equal(narrowTo('full', 'none'), 'none');
  assert.equal(narrowTo('view', 'full'), 'view', 'never more than the rules give');
  assert.equal(narrowTo('own', 'full'), 'own');
  assert.equal(narrowTo('none', 'view'), 'none');
  assert.equal(narrowTo('full', ''), 'full');
});
check('what an owner may pick runs from None up to the standard, with no prices only where prices are shown', () => {
  assert.deepEqual(levelChoices('full'), ['none', 'view', 'full']);
  assert.deepEqual(levelChoices('own'), ['none', 'view', 'own']);
  assert.deepEqual(levelChoices('view'), ['none', 'view']);
  assert.deepEqual(levelChoices('used'), ['none', 'used']);
  assert.deepEqual(levelChoices('none'), ['none']);
  assert.deepEqual(levelChoices('full', { area: 'contracts', prices: true }), ['none', 'tonnes', 'view', 'full']);
  assert.deepEqual(levelChoices('full', { area: 'contracts', prices: false }), ['none', 'view', 'full']);
});
check('the table follows: a bookkeeper set to See on contracts shows See, and an owner column never changes', () => {
  const rows = effectiveAccess({}, { contracts: { bookkeeper: 'view' }, loads: { manager: 'none' }, position: { owner: 'none' } });
  assert.equal(rows.find((r) => r.key === 'contracts').bookkeeper, 'view');
  assert.equal(rows.find((r) => r.key === 'loads').manager, 'none');
  assert.equal(rows.find((r) => r.key === 'position').owner, 'view');
});
check('every area a choice can be made in is a row of the table, with a key', () => {
  for (const a of LEVEL_AREAS) assert.ok(ACCESS.some((r) => r.key === a), a);
  assert.ok(ACCESS.every((r) => r.key), 'every row has a key');
  assert.equal(new Set(ACCESS.map((r) => r.key)).size, ACCESS.length);
  assert.ok(!LEVEL_AREAS.includes('people') && !LEVEL_AREAS.includes('settings'), 'People and Settings are the owner\'s');
  for (const t of Object.values(AREA_TAB)) assert.ok(['position', 'production', 'sales', 'movement', 'storage', 'reports'].includes(t));
});

console.log('\n=== the screens ===');
check('None takes the tab away, and the person lands on the first one left', () => {
  reset();
  assert.deepEqual(tabsForRole('bookkeeper'), ['sales', 'production', 'movement', 'reports']);
  setFarmLevels({ production: { bookkeeper: 'none' }, reports: { bookkeeper: 'none' } });
  assert.deepEqual(tabsForRole('bookkeeper'), ['sales', 'movement']);
  assert.equal(canOpen('bookkeeper', 'production'), false);
  assert.deepEqual(tabsForRole('driver'), ['movement'], 'another role is not touched');
  setFarmLevels({ loads: { driver: 'none' } });
  assert.deepEqual(tabsForRole('driver'), []);
  assert.equal(landingTabFor('driver'), 'account', 'there is always somewhere to land, and to sign out');
  reset();
});
check('the gates follow: orders, overheads, prices, bills, loads, paddocks and stock', () => {
  reset();
  assert.equal(canSeeOrders('manager'), true);
  setFarmLevels({ grainorders: { manager: 'none' }, overheads: { manager: 'none' }, contracts: { bookkeeper: 'tonnes' }, invoices: { bookkeeper: 'none' }, bills: { bookkeeper: 'none' }, loads: { manager: 'view' }, production: { manager: 'view' } });
  assert.equal(canSeeOrders('manager'), false);
  setFarmSwitches({ managerSeesOverheads: true });
  assert.equal(canSeeOverheads('manager'), false, 'a switch gives access, and the owner has taken it away again');
  assert.equal(canSeePrices('bookkeeper'), false);
  assert.equal(canSeeBills('bookkeeper'), false);
  assert.equal(canEditLoads('manager'), false);
  assert.equal(canChangeProduction('manager'), false);
  assert.equal(canChangeArea('manager', 'loads'), false);
  assert.equal(canSeeArea('manager', 'loads'), true, 'See still sees');
  assert.equal(canSeeBills('owner'), true);
  reset();
  assert.equal(canSeePrices('bookkeeper'), true);
  assert.equal(canSeeBills('bookkeeper'), true);
});
check('the app hands the saved choices to nav.js, and the phone leaves out what it may not send', () => {
  assert.ok(read('docs/js/storage.js').includes('setFarmLevels(readLevels(data.businessDetails?.switches))'));
  const sy = read('docs/js/sync.js');
  assert.ok(sy.includes("for (const [area, tables] of Object.entries(LEVEL_TABLES)) if (['none', 'view'].includes(farmLevel(role, area)))"));
  assert.ok(sy.includes('return list.filter((x) => !held.has(x));'));
  const v = read('docs/js/views/settingspeople.js');
  assert.ok(v.includes('data-level="') && v.includes('withLevel(') && v.includes('data-level-reset'));
  assert.ok(read('docs/js/views/help.js').includes('readLevels(db.getBusinessDetails().switches)'), 'Help shows the farm\'s own table');
});

console.log('\n=== the database ===');
check('every table of every area has a restrictive policy for select, insert and update, and the file is the one the code lists', () => {
  const sql = read('supabase/migrations/20261220000000_access_levels.sql');
  assert.ok(sql.includes('create or replace function app_cell(p_farm uuid, p_area text)') && sql.includes('grant execute on function app_cell(uuid, text) to authenticated;'));
  for (const [area, tables] of Object.entries(LEVEL_TABLES)) {
    for (const t of tables) {
      assert.ok(new RegExp(`create policy ${t}_level_select on ${t} as restrictive for select\\s+using \\(app_cell\\(farm_id, '${area}'\\)`).test(sql), `${t} select`);
      assert.ok(new RegExp(`create policy ${t}_level_insert on ${t} as restrictive for insert\\s+with check \\(app_cell\\(farm_id, '${area}'\\) not in \\('none', 'view', 'tonnes'\\)\\)`).test(sql), `${t} insert`);
      assert.ok(new RegExp(`create policy ${t}_level_update on ${t} as restrictive for update\\s+using \\(app_cell\\(farm_id, '${area}'\\) not in \\('none', 'view', 'tonnes'\\)\\)\\s+with check`).test(sql), `${t} update`);
    }
  }
  assert.ok(sql.includes("create policy sale_terms_level_select on sale_terms as restrictive for select\n  using (app_cell(farm_id, 'contracts') not in ('none', 'tonnes'));"), 'the prices are held back at tonnes');
  assert.equal((sql.match(/as restrictive/g) || []).length, Object.values(LEVEL_TABLES).flat().length * 3, 'nothing else, nothing missing');
  assert.ok(!/create policy [a-z_]+ on [a-z_]+ for /.test(sql), 'no permissive policy is added: this only ever takes away');
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('function app_cell('));
});
check('the policies match the guide: nothing in them names the owner, so an owner is never held back, and the area names are the keys', () => {
  const sql = read('supabase/migrations/20261220000000_access_levels.sql');
  assert.ok(!sql.slice(sql.indexOf('-- production:')).includes("'owner'"));
  for (const m of sql.matchAll(/app_cell\(farm_id, '(\w+)'\)/g)) assert.ok(LEVEL_AREAS.includes(m[1]) && !SCREEN_AREAS.includes(m[1]), m[1]);
});
check('the policy test of help.test.mjs does not read these as standard policies (they are restrictive)', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const sql = readFileSync(new URL('20261220000000_access_levels.sql', dir), 'utf8');
  assert.ok(!/create policy \w+_(select|insert|update) on \w+ for /.test(sql));
  assert.ok(readdirSync(dir).includes('20261220000000_access_levels.sql'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
