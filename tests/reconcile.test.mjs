#!/usr/bin/env node
//
// Re-importing a season into a farm that already has one.
//
//   node tests/reconcile.test.mjs
//
// The fault this guards against did not look like a data fault. Pushing an
// imported season minted a new id for a season label the farm already had,
// which violates the unique constraint on (farm_id, label). The upsert
// conflicts on `id` and so never sees the clash; Postgres returns 23505; and
// because `seasons` is the first table in the push order, the push stops there
// and nothing at all is sent. The import reports success, the outbox never
// drains, and every paddock, contract and fertiliser record stays on the
// device. It presented as "the fertiliser detail didn't come through".

import assert from 'node:assert';
import { reconcileImport, adoptServerIds } from '../docs/js/reconcile.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); }
  catch (e) { failures += 1; console.log(`  FAIL  ${name}\n         ${e.message}`); }
};

const year = (over = {}) => ({
  commodities: [], fields: [], storages: [], sales: [], movements: [], invoices: [],
  ...over,
});
const rows = (...ids) => ids.map((id) => ({ id }));

const collect = () => {
  const calls = [];
  const fn = (table, id) => calls.push(`${table}:${id}`);
  fn.calls = calls;
  return fn;
};

console.log('\n=== the season row is updated, not duplicated ===');

check('an existing season id is carried onto the imported season', () => {
  const previous = { years: { 2026: year({ __seasonId: 'season-1' }) } };
  const next = { years: { 2026: year() } };
  reconcileImport(previous, next, collect());
  assert.equal(next.years['2026'].__seasonId, 'season-1',
    'without this the push is rejected by seasons_farm_id_label_key');
});

check('the overheads row id is carried too', () => {
  const previous = { years: { 2026: year({ __seasonId: 's1', __overheadsId: 'oh-1' }) } };
  const next = { years: { 2026: year() } };
  reconcileImport(previous, next, collect());
  assert.equal(next.years['2026'].__overheadsId, 'oh-1');
});

check('a season the farm does not have yet is left alone', () => {
  const previous = { years: { 2025: year({ __seasonId: 's-2025' }) } };
  const next = { years: { 2026: year() } };
  reconcileImport(previous, next, collect());
  assert.equal(next.years['2026'].__seasonId, undefined);
});

console.log('\n=== what the import replaces is retired ===');

check('old paddocks are tombstoned so the farm does not hold both sets', () => {
  const previous = { years: { 2026: year({ fields: rows('old-a', 'old-b') }) } };
  const next = { years: { 2026: year({ fields: rows('new-a', 'new-b') }) } };
  const retire = collect();
  const n = reconcileImport(previous, next, retire);
  assert.equal(n, 2);
  assert.deepEqual(retire.calls.sort(), ['fields:old-a', 'fields:old-b']);
});

check('every record type is retired, not just paddocks', () => {
  const previous = { years: { 2026: year({
    commodities: rows('c1'), fields: rows('f1'), storages: rows('s1'),
    sales: rows('sa1'), movements: rows('m1'), invoices: rows('i1'),
  }) } };
  const next = { years: { 2026: year() } };
  const retire = collect();
  reconcileImport(previous, next, retire);
  assert.deepEqual(retire.calls.sort(), [
    'commodities:c1', 'fields:f1', 'invoices:i1',
    'movements:m1', 'sales:sa1', 'storages:s1',
  ]);
});

check('a record the import keeps is not retired', () => {
  // Importing a file that has already been imported: the ids match, so nothing
  // is replaced and nothing should be deleted.
  const previous = { years: { 2026: year({ fields: rows('a', 'b') }) } };
  const next = { years: { 2026: year({ fields: rows('a', 'b') }) } };
  const retire = collect();
  assert.equal(reconcileImport(previous, next, retire), 0);
  assert.deepEqual(retire.calls, []);
});

check('a season not being imported is untouched', () => {
  // Importing only 2026 must not delete 2025. Someone re-importing one season
  // is not asking to lose the other.
  const previous = { years: {
    2025: year({ fields: rows('keep-me') }),
    2026: year({ fields: rows('old') }),
  } };
  const next = { years: { 2026: year({ fields: rows('new') }) } };
  const retire = collect();
  reconcileImport(previous, next, retire);
  assert.deepEqual(retire.calls, ['fields:old']);
});

console.log('\n=== a first import into an empty farm ===');

check('nothing to reconcile, nothing retired', () => {
  const next = { years: { 2026: year({ fields: rows('a') }) } };
  const retire = collect();
  assert.equal(reconcileImport({ years: {} }, next, retire), 0);
  assert.deepEqual(retire.calls, []);
});

check('no previous state at all does not throw', () => {
  const next = { years: { 2026: year({ fields: rows('a') }) } };
  assert.equal(reconcileImport(null, next, collect()), 0);
  assert.equal(reconcileImport(undefined, next, collect()), 0);
});

check('a malformed old record is skipped rather than crashing the import', () => {
  const previous = { years: { 2026: year({ fields: [null, { }, { id: 'ok' }] }) } };
  const next = { years: { 2026: year() } };
  const retire = collect();
  assert.equal(reconcileImport(previous, next, retire), 1);
  assert.deepEqual(retire.calls, ['fields:ok']);
});

console.log('\n=== repairing a device that already imported ===');

check('a season with no id adopts the one the server has', () => {
  const local = { years: { 2026: year() } };
  const server = { years: { 2026: year({ __seasonId: 'server-season' }) } };
  assert.equal(adoptServerIds(local, server), 1);
  assert.equal(local.years['2026'].__seasonId, 'server-season');
});

check('a stale id is replaced by the one that actually exists', () => {
  const local = { years: { 2026: year({ __seasonId: 'invented' }) } };
  const server = { years: { 2026: year({ __seasonId: 'real' }) } };
  adoptServerIds(local, server);
  assert.equal(local.years['2026'].__seasonId, 'real');
});

check('overheads identity is adopted as well', () => {
  const local = { years: { 2026: year() } };
  const server = { years: { 2026: year({ __seasonId: 's', __overheadsId: 'oh' }) } };
  adoptServerIds(local, server);
  assert.equal(local.years['2026'].__overheadsId, 'oh');
});

check('a season the server does not have keeps whatever it has', () => {
  const local = { years: { 2027: year({ __seasonId: 'mine' }) } };
  const server = { years: { 2026: year({ __seasonId: 'theirs' }) } };
  assert.equal(adoptServerIds(local, server), 0);
  assert.equal(local.years['2027'].__seasonId, 'mine');
});

check('no data is copied across, only row identity', () => {
  const local = { years: { 2026: year({ fields: rows('local-1') }) } };
  const server = { years: { 2026: year({ __seasonId: 's', fields: rows('server-1') }) } };
  adoptServerIds(local, server);
  assert.deepEqual(local.years['2026'].fields, rows('local-1'),
    'boot.js decides whose data wins; this decides only which row it lands on');
});

check('missing or empty states do not throw', () => {
  assert.equal(adoptServerIds(null, { years: {} }), 0);
  assert.equal(adoptServerIds({ years: {} }, null), 0);
  assert.equal(adoptServerIds(undefined, undefined), 0);
});

console.log('');
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('ALL PASS');
