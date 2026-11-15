// Run with:
//   node tests/security.test.mjs
//
// Bank details held apart from the farm row (owner and bookkeeper read, owner writes), and farm workers seeing
// stock with no prices.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';
import { selectDirtyRows, pushRowsFor } from '../docs/js/dirty.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const FARM = '11111111-1111-1111-1111-111111111111';
const BANK = { bankName: 'NAB', accountName: 'Carrigan Farms', bsb: '084-000', accountNumber: '12345678' };
const state = { currentYear: '2026', businessDetails: { entityName: 'Carrigan Farms', ...BANK }, years: { 2026: { commodities: [], fields: [], storages: [], sales: [], invoices: [], overheads: {}, movements: [] } } };

console.log('\n=== bank details ===');
check('the farm row no longer carries them; a row of their own does', () => {
  const rows = stateToRows(state, FARM);
  for (const col of ['bank_name', 'account_name', 'bsb', 'account_number']) assert.ok(!(col in rows.farms[0]), `${col} is still in the farm row`);
  assert.deepEqual(rows.farm_bank, [{ farm_id: FARM, bank_name: 'NAB', account_name: 'Carrigan Farms', bsb: '084-000', account_number: '12345678' }]);
});
check('they are read back from that row', () => {
  const back = rowsToState(stateToRows(state, FARM));
  for (const k of Object.keys(BANK)) assert.equal(back.businessDetails[k], BANK[k]);
});
check('a manager is sent no row: the bank details read as blank, and a farm row from before still works', () => {
  const rows = stateToRows(state, FARM);
  const manager = rowsToState({ ...rows, farm_bank: [] });
  for (const k of Object.keys(BANK)) assert.equal(manager.businessDetails[k], '');
  const old = rowsToState({ ...rows, farm_bank: [], farms: [{ ...rows.farms[0], bank_name: 'Old Bank', bsb: '1' }] });
  assert.equal(old.businessDetails.bankName, 'Old Bank');
});
check('they are sent with the business details and not with anything else', () => {
  const rows = stateToRows(state, FARM);
  assert.equal(selectDirtyRows(rows, state, [{ kind: 'business' }]).farm_bank.length, 1);
  assert.equal(selectDirtyRows(rows, state, [{ kind: 'season', id: '2026' }]).farm_bank.length, 0);
  assert.equal(selectDirtyRows(rows, state, [{ kind: 'all' }]).farm_bank.length, 1);
});
check('only the owner pushes them, to their own table, and they are read back', () => {
  const sync = read('docs/js/sync.js');
  assert.match(sync, /role === 'owner' && rows\.farms\?\.\[0\][\s\S]*?from\('farm_bank'\)\.upsert/);
  assert.match(read('docs/js/hydrate.js'), /'farm_bank'/);
  assert.match(read('docs/js/hydrate.js'), /table !== 'farm_bank'/, 'the bank row has no deleted_at');
});
check('the database: owner and bookkeeper read, only the owner writes, older apps are caught by a trigger', () => {
  const sql = read('supabase/migrations/20261117100000_bank_and_worker_inputs.sql');
  assert.match(sql, /farm_bank_select on farm_bank for select\s+using \(app_role\(farm_id\) in \('owner', 'bookkeeper'\)\)/);
  assert.match(sql, /farm_bank_insert on farm_bank for insert\s+with check \(app_role\(farm_id\) = 'owner'\)/);
  assert.match(sql, /farm_bank_update on farm_bank for update\s+using \(app_role\(farm_id\) = 'owner'\)/);
  assert.match(sql, /create trigger farms_move_bank_trg before insert or update on farms/);
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes(sql.trim().split('\n').slice(-3).join('\n')), 'it is in the paste file');
});

console.log('\n=== stock for a farm worker ===');
check('a worker sends only use and count entries', () => {
  const list = [{ move_type: 'buy' }, { move_type: 'use' }, { move_type: 'adjust' }];
  assert.deepEqual(pushRowsFor('input_stock', 'farm_worker', list).map((r) => r.move_type), ['use', 'adjust']);
  assert.equal(pushRowsFor('input_stock', 'manager', list).length, 3);
  assert.equal(pushRowsFor('sales', 'farm_worker', list).length, 3);
});
check('a worker reads stock through the function that blanks the prices', () => {
  assert.match(read('docs/js/hydrate.js'), /rpc\('input_stock_for_worker'/);
  assert.match(read('docs/js/storage.js'), /hydrate\(farmId, role\)/);
  const sql = read('supabase/migrations/20261117100000_bank_and_worker_inputs.sql');
  assert.match(sql, /null::numeric, s\.move_date, null::text, null::text/, 'price, supplier and reference come back blank');
  assert.match(sql, /app_role\(p_farm_id\) = 'farm_worker'/);
  assert.match(sql, /revoke all on function input_stock_for_worker\(uuid\) from public/);
});
check('and the table lets a worker write only use and count entries with no price', () => {
  const sql = read('supabase/migrations/20261117100000_bank_and_worker_inputs.sql');
  assert.match(sql, /input_stock_insert[\s\S]*?app_role\(farm_id\) = 'farm_worker' and move_type in \('use', 'adjust'\) and unit_cost is null/);
  assert.ok(!/farm_worker'[^;]*'buy'/.test(sql), 'a worker is never allowed a delivery');
});
check('the screens show a worker no price and offer no delivery', () => {
  const v = read('docs/js/views/inputs.js');
  assert.ok(v.includes("const seesPrices = () => db.getRole() !== 'farm_worker';"));
  assert.ok(v.includes('priced ? \'<button type="button" class="btn" data-new="buy">'));
  assert.ok(v.includes("MOVE_TYPES.filter((t) => priced || t.key !== 'buy')"));
  assert.ok(v.includes('priced && l.avgCost > 0'));
});

console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
process.exit(failures ? 1 : 0);
