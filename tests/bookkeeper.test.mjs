// Run with:
//   node tests/bookkeeper.test.mjs
//
// A bookkeeper does the money side. No Position, no Storage, no overheads, no grain orders, and no changing paddocks or stock.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tabsForRole, canOpen, landingTabFor, canSeeOrders, canSeeOverheads, canChangeProduction, canSeeYield, setFarmSwitches } from '../docs/js/nav.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

check('the bar is Sales, Production, Movement and Reports, and Sales is where they land', () => {
  assert.deepEqual(tabsForRole('bookkeeper'), ['sales', 'production', 'movement', 'reports']);
  assert.equal(landingTabFor('bookkeeper'), 'sales');
  assert.equal(canOpen('bookkeeper', 'position'), false);
  assert.equal(canOpen('bookkeeper', 'storage'), false);
  assert.equal(canOpen('bookkeeper', 'settings'), true);
});

check('grain orders and overheads are not for a bookkeeper; an owner has both; a manager has overheads only when the farm switches it on', () => {
  setFarmSwitches({});
  assert.equal(canSeeOrders('bookkeeper'), false);
  assert.equal(canSeeOverheads('bookkeeper'), false);
  assert.ok(canSeeOrders('owner') && canSeeOrders('manager') && canSeeOverheads('owner'));
  assert.equal(canSeeOverheads('manager'), false);
  setFarmSwitches({ managerSeesOverheads: true });
  assert.equal(canSeeOverheads('manager'), true);
  assert.equal(canSeeOverheads('bookkeeper'), false);
  setFarmSwitches({});
});

check('a bookkeeper, an advisor and the support login look at production and change none of it; the others may', () => {
  for (const r of ['bookkeeper', 'advisor', 'support']) assert.equal(canChangeProduction(r), false, r);
  for (const r of ['owner', 'manager', 'farm_worker']) assert.equal(canChangeProduction(r), true, r);
  assert.equal(canSeeYield('bookkeeper'), true);
});

check('the server agrees: overheads owner only, orders not sent to a bookkeeper, stock written by owner, manager and worker', () => {
  const sql = read('supabase/migrations/20261219000000_bookkeeper_narrower.sql');
  assert.ok(sql.includes("create policy overheads_select on overheads for select\n  using (app_role(farm_id) = 'owner'"));
  assert.ok(/create policy orders_select on orders for select\s+using \(app_role\(farm_id\) in \('owner', 'manager', 'farm_worker', 'driver', 'advisor', 'support'\)/.test(sql));
  assert.ok(/create policy orders_insert on orders for insert\s+with check \(app_role\(farm_id\) in \('owner', 'manager'\)\)/.test(sql));
  const stock = sql.slice(sql.indexOf('create policy input_stock_insert'));
  assert.ok(!stock.includes('bookkeeper'), 'no bookkeeper on the stock writes');
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('overheads_select on overheads'));
});

check('the screens follow: no orders tile or contract orders, no overheads card, no add-paddock button, a frozen paddock sheet, no stock buttons', () => {
  const sales = read('docs/js/views/sales.js');
  assert.ok(sales.includes("canSeeOrders(db.getRole()) ? `<button type=\"button\" class=\"btn secondary tool-tile\" id=\"open-orders\">") && sales.includes('existing && canSeeOrders(db.getRole()) ? `<div id="contract-orders"'));
  assert.ok(read('docs/js/views/settings.js').includes('${canSeeOverheads(db.getRole()) ? `'));
  const prod = read('docs/js/views/production.js');
  assert.ok(prod.includes("canChangeProduction(db.getRole()) ? '<button class=\"fab\" id=\"add-field\">+</button>' : ''") && prod.includes('if (!canChangeProduction(db.getRole())) freezeSheet(root);'));
  const inp = read('docs/js/views/inputs.js');
  assert.ok(inp.includes("if (!canChangeInputs(db.getRole())) return '';"));
  const sy = read('docs/js/sync.js');
  const w = sy.slice(sy.indexOf('const WRITABLE'));
  assert.ok(!/bookkeeper: \[[^\]]*(overheads|'orders'|input_stock)/.test(w), 'a bookkeeper does not push those');
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
