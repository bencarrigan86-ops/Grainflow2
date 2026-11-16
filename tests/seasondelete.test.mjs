// Run with:
//   node tests/seasondelete.test.mjs
//
// Deleting a season and resetting the farm cannot be taken back, so they are made deliberate: the person reads what goes,
// has a backup, types the name, and only the owner is offered either.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seasonContents, contentsText, backedUpRecently, typedName, mayDelete, BACKUP_FRESH_MS } from '../docs/js/seasondelete.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

check('the contents are counted, one by one, and only what is there', () => {
  const year = { fields: [{}, {}, {}], sales: [{}], movements: [{}, {}], invoices: [], storages: undefined };
  assert.deepEqual(seasonContents(year), [
    { label: 'paddocks', count: 3 }, { label: 'contract', count: 1 }, { label: 'loads', count: 2 },
  ]);
  assert.deepEqual(seasonContents(null), []);
});

check('the contents read as a sentence', () => {
  assert.equal(contentsText(seasonContents({ fields: [{}, {}], sales: [{}], movements: [{}, {}, {}] })), '2 paddocks, 1 contract and 3 loads');
  assert.equal(contentsText(seasonContents({ fields: [{}] })), '1 paddock');
  assert.equal(contentsText([]), 'nothing in it');
});

check('a backup counts only if it was made in the last hour', () => {
  const now = 1_000_000_000;
  assert.equal(backedUpRecently(null, now), false);
  assert.equal(backedUpRecently(now - 60_000, now), true);
  assert.equal(backedUpRecently(now - BACKUP_FRESH_MS, now), true);
  assert.equal(backedUpRecently(now - BACKUP_FRESH_MS - 1, now), false);
  assert.equal(backedUpRecently(now + 60_000, now), false, 'a backup from the future is not a backup');
});

check('the name has to be typed: capitals and end spaces do not matter, nothing else does', () => {
  assert.equal(typedName('Sample 2026', 'Sample 2026'), true);
  assert.equal(typedName('  sample 2026 ', 'Sample 2026'), true);
  assert.equal(typedName('Sample 2025', 'Sample 2026'), false);
  assert.equal(typedName('Sample', 'Sample 2026'), false);
  assert.equal(typedName('', ''), false, 'nothing typed is never a match');
  assert.equal(typedName(undefined, 'x'), false);
});

check('the button needs both the name and a backup', () => {
  assert.equal(mayDelete({ typed: '2026', name: '2026', backedUp: true }), true);
  assert.equal(mayDelete({ typed: '2026', name: '2026', backedUp: false }), false);
  assert.equal(mayDelete({ typed: '', name: '2026', backedUp: true }), false);
  assert.equal(mayDelete({ typed: '2025', name: '2026', backedUp: true }), false);
});

check('Settings opens the sheet for both, and no longer asks with one plain dialog', () => {
  const s = read('docs/js/views/settings.js');
  const season = s.slice(s.indexOf("deleteYearBtn.addEventListener('click'"), s.indexOf("root.querySelector('#export')"));
  assert.ok(season.includes('openDangerSheet(') && season.includes('db.deleteYear(currentYear)') && !season.includes('confirmDelete('), 'season delete is still one dialog');
  const reset = s.slice(s.indexOf("root.querySelector('#reset')"), s.indexOf("root.querySelector('#force-refresh')"));
  assert.ok(reset.includes('openDangerSheet(') && reset.includes('db.resetAll()') && !reset.includes('confirmDelete('), 'reset is still one dialog');
});

check('only the owner is offered either button', () => {
  const s = read('docs/js/views/settings.js');
  assert.ok(/getRole\(\) === 'owner' \? `<button class="btn danger small" id="delete-year"/.test(s), 'season delete is offered to every role');
  assert.ok(/getRole\(\) === 'owner' \? '<button class="btn danger small" id="reset"/.test(s), 'reset is offered to every role');
});

check('only an owner can delete a season: the data layer, and the server, say so', () => {
  const st = read('docs/js/storage.js');
  const del = st.slice(st.indexOf('deleteYear(year) {'), st.indexOf('// --- commodities ---'));
  assert.ok(/deleteYear\(year\) \{[\s\S]*?if \(role !== 'owner'\) return false;/.test(del), 'deleteYear does not check the role');
  assert.ok(/resetAll\(\) \{\s*if \(role !== 'owner'\) return;/.test(st), 'resetAll does not check the role');
  const sql = read('supabase/migrations/20261118300000_season_delete_owner_only.sql');
  assert.ok(/p_table = 'seasons' and app_role\(v_farm\) is distinct from 'owner'/.test(sql), 'the server does not limit seasons to the owner');
  assert.ok(sql.includes("'seasons', 'commodities', 'fields'") && sql.includes("'spray_jobs'") && sql.includes("'record_documents'"), 'the function lost tables it handled before');
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes("only the owner can delete a season"), 'not in the paste file');
});

check('the sheet keeps the button off until the name is typed and a backup is in hand, and checks again on the tap', () => {
  const v = read('docs/js/views/dangerconfirm.js');
  assert.ok(v.includes('goBtn.disabled = !mayDelete('), 'the button is not disabled');
  assert.ok(/goBtn\.addEventListener\('click', \(\) => \{[\s\S]*?if \(!mayDelete\(/.test(v), 'the tap does not check again');
  assert.ok(v.includes('downloadBackup(db.exportJSON())'), 'no way to take the backup from the sheet');
  assert.ok(v.includes('Recently deleted cannot bring it back'), 'does not say it is permanent');
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
