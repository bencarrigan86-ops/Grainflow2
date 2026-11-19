// Run with:
//   node tests/accesslevels.test.mjs
//
// What an owner can set for a role, area by area, up or down from the standard rules: kept with the farm, applied to the tabs and the
// screens, left out of (or added to) what a phone sends, and enforced by the database beside the standard policies.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  LEVEL_ROLES, LEVEL_AREAS, LEVEL_TABLES, SCREEN_AREAS, AREA_TAB, readLevels, withLevel, withSwitch, readSwitches, levelNow, levelChoices, pricesShown,
} from '../docs/js/farmswitches.js';
import { ACCESS, effectiveAccess, missingAreas, missingLine, pickWarning, levelFor } from '../docs/js/helpcontent.js';
import { hubGroups } from '../docs/js/reportshub.js';
import {
  setFarmSwitches, setFarmLevels, tabsForRole, landingTabFor, canOpen, canSeeOrders, canSeeOverheads, canSeePrices, canSeeBills, canEditLoads,
  canChangeProduction, canSeeArea, canChangeArea, canSeeFreight, canAddContracts, canChangeInputs,
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

console.log('\n=== less, and more ===');
check('a pick is the whole answer, above or below the standard; no pick is the standard', () => {
  assert.equal(levelNow('full', 'view'), 'view');
  assert.equal(levelNow('full', 'none'), 'none');
  assert.equal(levelNow('view', 'full'), 'full', 'raised above what the rules give');
  assert.equal(levelNow('none', 'view'), 'view');
  assert.equal(levelNow('full', ''), 'full');
  assert.equal(levelNow('own', undefined), 'own');
});
check('what an owner may pick runs from None up to Full; no prices only on contracts; own loads and used stock stay as they are', () => {
  assert.deepEqual(levelChoices('full'), ['none', 'view', 'full']);
  assert.deepEqual(levelChoices('view'), ['none', 'view', 'full']);
  assert.deepEqual(levelChoices('none'), ['none', 'view', 'full'], 'a cell at None can be raised');
  assert.deepEqual(levelChoices('own'), ['none', 'view', 'own']);
  assert.deepEqual(levelChoices('used'), ['none', 'used']);
  assert.deepEqual(levelChoices('draft'), ['none', 'view', 'draft', 'full']);
  assert.deepEqual(levelChoices('tonnes', { area: 'contracts' }), ['none', 'tonnes', 'view', 'full']);
  assert.deepEqual(levelChoices('full', { area: 'contracts' }), ['none', 'tonnes', 'view', 'full']);
});
check('prices are shown by the standard rules to an owner, a bookkeeper, and a manager or advisor only with the switches', () => {
  assert.equal(pricesShown('bookkeeper'), true);
  assert.equal(pricesShown('manager', {}), false);
  assert.equal(pricesShown('manager', { managerSeesPrices: true }), true);
  assert.equal(pricesShown('advisor', { advisorSeesLoads: true }), false);
  assert.equal(pricesShown('advisor', { advisorSeesLoads: true, advisorSeesPrices: true }), true);
});
check('the table follows: a manager without prices shows No prices, a pick shows as picked, and an owner column never changes', () => {
  const cell = (rows, key, role) => rows.find((r) => r.key === key)[role];
  assert.equal(cell(effectiveAccess({}), 'contracts', 'manager'), 'tonnes');
  assert.equal(cell(effectiveAccess({ managerSeesPrices: true }), 'contracts', 'manager'), 'view');
  const rows = effectiveAccess({}, { contracts: { bookkeeper: 'view', driver: 'full' }, loads: { manager: 'none', advisor: 'view' }, position: { owner: 'none', bookkeeper: 'view' }, production: { driver: 'view' } });
  assert.equal(cell(rows, 'contracts', 'bookkeeper'), 'view');
  assert.equal(cell(rows, 'contracts', 'driver'), 'full', 'raised from none');
  assert.equal(cell(rows, 'loads', 'manager'), 'none');
  assert.equal(cell(rows, 'loads', 'advisor'), 'view', 'raised from none');
  assert.equal(cell(rows, 'position', 'bookkeeper'), 'view', 'raised from none');
  assert.equal(cell(rows, 'position', 'owner'), 'view');
  assert.equal(cell(rows, 'production', 'driver'), 'view');
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
  assert.deepEqual(tabsForRole('bookkeeper'), ['production', 'sales', 'movement', 'reports']);
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
check('raising: a pick above the standard gives the tab, the buttons and the tables the role did not have', () => {
  reset();
  assert.deepEqual(tabsForRole('driver'), ['movement']);
  setFarmLevels({ production: { driver: 'view' }, contracts: { driver: 'tonnes' }, reports: { driver: 'full' } });
  assert.deepEqual(tabsForRole('driver'), ['production', 'sales', 'movement', 'reports'], 'a tab the owner gives goes in its usual place');
  assert.equal(landingTabFor('driver'), 'movement', 'but a driver still opens on loads');
  assert.equal(canOpen('driver', 'production'), true);
  assert.equal(canChangeProduction('driver'), false, 'See does not change');
  assert.equal(canSeePrices('driver'), false, 'no prices');
  setFarmLevels({ production: { driver: 'full' }, contracts: { driver: 'view' } });
  assert.equal(canChangeProduction('driver'), true);
  assert.equal(canSeePrices('driver'), true);
  assert.equal(canAddContracts('driver'), false);
  setFarmLevels({ contracts: { manager: 'full', advisor: 'full' }, grainorders: { bookkeeper: 'view' }, freightorders: { advisor: 'view' }, overheads: { manager: 'view' }, invoices: { advisor: 'view' }, loads: { advisor: 'full', bookkeeper: 'full' }, inputs: { bookkeeper: 'full' }, bills: { driver: 'view' } });
  assert.equal(canAddContracts('manager'), true);
  assert.equal(canSeeOrders('bookkeeper'), true);
  assert.equal(canSeeFreight('advisor'), true);
  assert.equal(canSeeOverheads('manager'), true);
  assert.equal(canSeeBills('advisor'), true);
  assert.equal(canSeeBills('driver'), true);
  assert.equal(canEditLoads('advisor'), true);
  assert.equal(canChangeInputs('bookkeeper'), true);
  assert.equal(canSeePrices('manager'), true);
  assert.equal(canSeeOrders('farm_worker'), false, 'nobody else is touched');
  reset();
  assert.equal(canAddContracts('manager'), false);
  assert.equal(canAddContracts('bookkeeper'), true);
  assert.equal(canChangeInputs('bookkeeper'), false);
  assert.equal(canSeeFreight('bookkeeper'), true);
  assert.equal(canSeeFreight('driver'), false);
});
check('the app hands the saved choices to nav.js, and the phone leaves out what it may not send', () => {
  assert.ok(read('docs/js/storage.js').includes('setFarmLevels(readLevels(data.businessDetails?.switches))'));
  const sy = read('docs/js/sync.js');
  assert.ok(sy.includes("for (const [area, tables] of Object.entries(LEVEL_TABLES)) if (['none', 'view'].includes(farmLevel(role, area)))"));
  assert.ok(sy.includes('return list.filter((x) => !held.has(x));'));
  assert.ok(sy.includes("if (farmLevel(role, area) === 'full') tables.forEach"), 'a table raised to Full is sent');
  const v = read('docs/js/views/settingspeople.js');
  assert.ok(v.includes('data-level="') && v.includes('withLevel(') && v.includes('data-level-reset') && v.includes('class="ab-tap'), 'the oval is the button');
  assert.ok(v.includes('ab-up') && v.includes('ab-down'), 'more and less are outlined differently');
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

console.log('\n=== the database: raising ===');
check('every table of every area has permissive policies that add See and Full, in a file the paste file carries', () => {
  const sql = read('supabase/migrations/20261221000000_access_raise.sql');
  for (const [area, tables] of Object.entries(LEVEL_TABLES)) {
    for (const t of tables) {
      assert.ok(new RegExp(`create policy ${t}_raise_select on ${t} for select\\s+using \\(app_cell\\(farm_id, '${area}'\\) in \\(`).test(sql), `${t} select`);
      assert.ok(new RegExp(`create policy ${t}_raise_insert on ${t} for insert\\s+with check \\(app_cell\\(farm_id, '${area}'\\) = 'full'\\)`).test(sql), `${t} insert`);
      assert.ok(new RegExp(`create policy ${t}_raise_update on ${t} for update\\s+using \\(app_cell\\(farm_id, '${area}'\\) = 'full'\\)\\s+with check \\(app_cell\\(farm_id, '${area}'\\) = 'full'\\)`).test(sql), `${t} update`);
    }
  }
  assert.ok(sql.includes("create policy sale_terms_raise_select on sale_terms for select\n  using (app_cell(farm_id, 'contracts') in ('view', 'full') and deleted_at is null);"), 'the prices need See or Full, not No prices');
  assert.ok(sql.includes("create policy sales_raise_select on sales for select\n  using (app_cell(farm_id, 'contracts') in ('tonnes', 'view', 'full')"));
  assert.equal((sql.match(/create policy \w+_raise_/g) || []).length, Object.values(LEVEL_TABLES).flat().length * 3);
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('create policy fields_raise_select'));
});
check('the switches that hold rows back from a kind of login give way to the pick for that login in that area', () => {
  const sql = read('supabase/migrations/20261221000000_access_raise.sql');
  for (const [t, area] of [['movements', 'loads'], ['movement_legs', 'loads'], ['movement_photos', 'loads'], ['sales', 'contracts'], ['orders', 'grainorders'], ['invoices', 'invoices'], ['payables', 'bills']]) {
    const m = sql.match(new RegExp(`create policy ${t}_(advisor_\\w+|manager_hidden) on ${t} as restrictive for select\\s+using \\([^;]*app_cell\\(farm_id, '${area}'\\) in \\(`));
    assert.ok(m, t);
  }
  assert.ok(!sql.includes("'owner'"), 'nothing names the owner');
  for (const m of sql.matchAll(/app_cell\(farm_id, '(\w+)'\)/g)) assert.ok(LEVEL_AREAS.includes(m[1]) && !SCREEN_AREAS.includes(m[1]), m[1]);
});

console.log('\n=== a screen made from areas the role cannot see ===');
check('a screen says so, the reports built on the missing area are left out, and the owner is warned when picking', () => {
  const raw = { levels: { production: { bookkeeper: 'none' }, position: { bookkeeper: 'view' } } };
  assert.deepEqual(missingAreas('bookkeeper', 'position', raw), ['Production']);
  assert.deepEqual(missingAreas('bookkeeper', 'position', {}), [], 'a role that cannot see the screen at all has nothing missing');
  assert.deepEqual(missingAreas('manager', 'position', {}), []);
  assert.match(missingLine('bookkeeper', 'position', raw), /built from Production, which your login cannot see/);
  assert.equal(missingLine('manager', 'position', {}), '');
  assert.match(pickWarning('bookkeeper', 'position', raw), /Position is built from Production/);
  assert.match(pickWarning('bookkeeper', 'production', raw), /Position is partly built from Production/);
  assert.equal(pickWarning('driver', 'production', {}), '', 'a driver sees neither screen');
  assert.equal(levelFor('bookkeeper', 'production', raw), 'none');
  const has = (area) => levelFor('bookkeeper', area, raw) !== 'none';
  const ids = (h) => h.flatMap((g) => g.tiles.map((t) => t.id));
  const withAll = ids(hubGroups({ mode: 'full', role: 'bookkeeper', can: () => true }));
  const without = ids(hubGroups({ mode: 'full', role: 'bookkeeper', can: () => true, has }));
  for (const id of ['yield', 'harvest', 'fert', 'seed', 'room', 'trace']) { assert.ok(withAll.includes(id), id); assert.ok(!without.includes(id), id + ' needs Production'); }
  assert.ok(without.includes('loads') && without.includes('mtm'), 'what is still readable stays');
  const pos = read('docs/js/views/position.js');
  assert.ok(pos.includes("missingLine(db.getRole(), 'position'"), 'Position says so');
  assert.ok(read('docs/js/views/reports.js').includes("has: (area) => levelFor(role, area"), 'Reports passes what the role can see');
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
