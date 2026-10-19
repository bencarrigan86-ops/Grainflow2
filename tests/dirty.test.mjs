#!/usr/bin/env node
//
// A device sends what it changed — not everything it holds.
//
//   node tests/dirty.test.mjs
//
// The failure this guards against, in the order it happened: a phone that had
// been in a pocket for a week sent its whole copy of the farm to the server.
// The copy held last week's yields, and they went over the top of what the
// computer had saved since. The computer then reloaded, found nothing owed, took
// the server's copy as the better one, and the week's edits were gone. Nothing
// reported an error.
//
// The fix is that a push is built from what this device actually edited. These
// tests state that as a property — a device that is behind cannot write rows it
// never touched — rather than checking an implementation detail.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { remapIds } from '../docs/js/import.js';
import { stateToRows } from '../docs/js/mapping.js';
import { selectDirtyRows, isLegacyDirty, KINDS } from '../docs/js/dirty.js';
import { resolveLegacy } from '../docs/js/boot.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

const FARM = '11111111-1111-4111-8111-111111111111';
const seed = JSON.parse(readFileSync(new URL('../docs/demo/seed.json', import.meta.url), 'utf8'));
const { state } = remapIds(seed);
const label = state.currentYear;
const year = state.years[label];
year.__seasonId = '22222222-2222-4222-8222-222222222222';   // as after a normal hydrate

const rows = stateToRows(state, FARM);
const count = (r) => Object.fromEntries(Object.entries(r).map(([t, l]) => [t, l.length]));
const field = year.fields[0];
const field2 = year.fields[1];

console.log('\n=== only what was touched is sent ===');

check('a paddock sends its own row and its agronomy row, and nothing else', () => {
  const out = selectDirtyRows(rows, state, [{ kind: 'field', id: field.id }]);
  assert.deepEqual(out.fields.map((r) => r.id), [field.id]);
  assert.deepEqual(out.field_agronomy.map((r) => r.field_id), [field.id]);
  for (const t of Object.keys(out)) {
    if (t === 'fields' || t === 'field_agronomy') continue;
    assert.equal(out[t].length, 0, `${t} should be empty, had ${out[t].length}`);
  }
});

check('the stale-phone case: editing one paddock cannot write commodities, other paddocks or sales', () => {
  // The exact shape of the bug. A phone holds an old copy of everything and the
  // person edits one thing on it.
  const out = selectDirtyRows(rows, state, [{ kind: 'field', id: field.id }]);
  assert.equal(out.commodities.length, 0, 'commodity yields and prices must not be re-sent');
  assert.equal(out.sales.length, 0);
  assert.equal(out.movements.length, 0);
  assert.ok(!out.fields.some((r) => r.id === field2.id), 'an untouched paddock must not be sent');
});

check('nothing touched, nothing sent', () => {
  const out = selectDirtyRows(rows, state, []);
  assert.deepEqual(Object.values(count(out)).reduce((a, b) => a + b, 0), 0);
});

check('a commodity sends only that commodity', () => {
  const c = year.commodities[0];
  const out = selectDirtyRows(rows, state, [{ kind: 'commodity', id: c.id }]);
  assert.deepEqual(out.commodities.map((r) => r.id), [c.id]);
  assert.equal(out.fields.length, 0);
});

check('a contract travels with its terms', () => {
  const sale = year.sales[0];
  const out = selectDirtyRows(rows, state, [{ kind: 'sale', id: sale.id }]);
  assert.deepEqual(out.sales.map((r) => r.id), [sale.id]);
  assert.deepEqual(out.sale_terms.map((r) => r.sale_id), [sale.id]);
  assert.equal(out.invoices.length, 0);
});

check('a load travels with its legs', () => {
  const m = year.movements[0];
  const out = selectDirtyRows(rows, state, [{ kind: 'movement', id: m.id }]);
  assert.deepEqual(out.movements.map((r) => r.id), [m.id]);
  const expected = rows.movement_legs.filter((l) => l.movement_id === m.id).length;
  assert.ok(expected > 0, 'the fixture load should have legs');
  assert.equal(out.movement_legs.length, expected);
  assert.ok(out.movement_legs.every((l) => l.movement_id === m.id));
});

check('an invoice sends only itself', () => {
  const inv = year.invoices[0];
  if (!inv) return; // the sample may carry none
  const out = selectDirtyRows(rows, state, [{ kind: 'invoice', id: inv.id }]);
  assert.deepEqual(out.invoices.map((r) => r.id), [inv.id]);
});

check('overheads, the season row and business details are each their own thing', () => {
  const oh = selectDirtyRows(rows, state, [{ kind: 'overheads', id: label }]);
  assert.equal(oh.overheads.length, 1);
  assert.equal(oh.fields.length, 0);
  const se = selectDirtyRows(rows, state, [{ kind: 'season', id: label }]);
  assert.equal(se.seasons.length, 1);
  assert.equal(se.fields.length, 0);
  const biz = selectDirtyRows(rows, state, [{ kind: 'business' }]);
  assert.equal(biz.farms.length, 1);
  assert.equal(biz.fields.length, 0);
});

check('"all" sends everything, and is the only thing that does', () => {
  const out = selectDirtyRows(rows, state, [{ kind: 'all' }]);
  assert.deepEqual(count(out), count(rows));
});

check('"year" sends a whole season', () => {
  const out = selectDirtyRows(rows, state, [{ kind: 'year', id: label }]);
  assert.equal(out.fields.length, rows.fields.length);
  assert.equal(out.commodities.length, rows.commodities.length);
  assert.equal(out.movement_legs.length, rows.movement_legs.length);
  assert.equal(out.seasons.length, 1);
});

check('two things touched send both and no more', () => {
  const out = selectDirtyRows(rows, state, [{ kind: 'field', id: field.id }, { kind: 'field', id: field2.id }]);
  assert.equal(out.fields.length, 2);
});

check('an unknown kind sends nothing rather than something', () => {
  const out = selectDirtyRows(rows, state, [{ kind: 'bogus', id: field.id }, { kind: 'field' }]);
  assert.equal(Object.values(count(out)).reduce((a, b) => a + b, 0), 0);
});

console.log('\n=== a row must not point at a season the server has not got ===');

check('the season rides along when the app has not yet learned its real id', () => {
  const fresh = JSON.parse(JSON.stringify(state));
  delete fresh.years[label].__seasonId;
  const r2 = stateToRows(fresh, FARM);
  const out = selectDirtyRows(r2, fresh, [{ kind: 'field', id: field.id }]);
  assert.equal(out.seasons.length, 1, 'otherwise the paddock has no season to belong to');
  assert.equal(out.fields[0].season_id, out.seasons[0].id);
});

check('a season the server already knows is NOT re-sent with a paddock', () => {
  const out = selectDirtyRows(rows, state, [{ kind: 'field', id: field.id }]);
  assert.equal(out.seasons.length, 0, 'a stale label would overwrite a rename made elsewhere');
});

console.log('\n=== the old whole-farm marker ===');

check('a bare marker with no kind is recognised as the old kind', () => {
  assert.equal(isLegacyDirty({ type: 'dirty', at: 1 }), true);
  assert.equal(isLegacyDirty({ type: 'dirty', kind: 'field', id: 'x' }), false);
  assert.equal(isLegacyDirty({ type: 'delete', table: 'fields', id: 'x' }), false);
});

const dec = (use) => ({ use });
check('old markers: take the server\'s copy and keep the device\'s aside', () => {
  assert.equal(resolveLegacy({ legacy: 1, decision: dec('server'), serverReachable: true, hasServer: true }), 'set-aside-and-adopt');
});
check('old markers: nothing to settle when there are none', () => {
  assert.equal(resolveLegacy({ legacy: 0, decision: dec('server'), serverReachable: true, hasServer: true }), 'none');
});
check('old markers: a farm the server has never seen is sent whole', () => {
  assert.equal(resolveLegacy({ legacy: 1, decision: dec('local'), serverReachable: true, hasServer: false }), 'send-all');
});
check('old markers: offline, they are left alone to be settled next time', () => {
  assert.equal(resolveLegacy({ legacy: 1, decision: dec('local'), serverReachable: false, hasServer: false }), 'keep');
});
check('old markers: if the device also has properly tracked work, that goes first', () => {
  assert.equal(resolveLegacy({ legacy: 1, decision: dec('local'), serverReachable: true, hasServer: true }), 'keep');
});
check('old markers: for some other farm, they mean nothing here', () => {
  assert.equal(resolveLegacy({ legacy: 1, decision: dec('fresh'), serverReachable: true, hasServer: false }), 'clear');
});

console.log('\n=== the bookkeeping is wired to the saves ===');

const storageSrc = readFileSync(new URL('../docs/js/storage.js', import.meta.url), 'utf8');
check('every kind a save records is one the selector understands', () => {
  const used = [...storageSrc.matchAll(/\btouch\('([a-z]+)'/g)].map((m) => m[1]);
  assert.ok(used.length >= 12, `expected a touch() per kind of save, found ${used.length}`);
  for (const k of used) assert.ok(KINDS.includes(k), `storage.js touches "${k}", which dirty.js does not know`);
});
check('every save that changes a record says what it touched', () => {
  for (const fn of ['upsertCommodity', 'upsertField', 'upsertSale', 'upsertStorage', 'upsertMovement',
    'createInvoice', 'setInvoiceStatus', 'updateInvoice', 'updateOverheads', 'updateBusinessDetails']) {
    const start = storageSrc.indexOf(`${fn}(`);
    assert.ok(start >= 0, `${fn} not found`);
    const end = storageSrc.indexOf('\n  },', start);
    assert.ok(storageSrc.slice(start, end).includes('touch('), `${fn} saves without recording what it changed`);
  }
});
check('the push no longer builds the whole farm', () => {
  const sync = readFileSync(new URL('../docs/js/sync.js', import.meta.url), 'utf8');
  assert.ok(sync.includes('selectDirtyRows(stateToRows('), 'sync.js must select dirty rows');
  assert.ok(!/const rows = stateToRows\(state, farmId\);/.test(sync), 'a bare stateToRows push is the old bug');
});

console.log('');
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('ALL PASS');
