#!/usr/bin/env node
//
// What is in a silo: crop year, grade, moisture, protein, screenings, test
// weight and falling number.
//
//   node tests/storagequality.test.mjs
//
// Two things matter here beyond "the numbers come back":
//
//   A storage with nothing recorded must send NO quality columns. They arrived in
//   a database migration, and a database that has not had it yet rejects any row
//   that names them. If every silo sent them, every silo would stop saving until
//   the migration was run, over a feature nobody had used.
//
//   A value that is cleared must still reach the server, as null. Leaving the
//   columns out once a silo has had quality recorded would mean "I emptied that
//   box" quietly never happened.

import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { stateToRows, rowsToState, hasStorageQuality } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

const FARM = '11111111-1111-4111-8111-111111111111';
const COLUMNS = ['crop_year', 'grade', 'moisture_pct', 'protein_pct', 'screenings_pct', 'test_weight_kg_hl', 'falling_number'];

const stateWith = (storage) => ({
  version: 2, currentYear: '2026',
  years: { 2026: { __seasonId: '22222222-2222-4222-8222-222222222222', commodities: [], fields: [], storages: [storage], sales: [], movements: [], invoices: [], overheads: {} } },
  businessDetails: {}, nextMovementNo: 1, nextInvoiceNo: 1,
});
const SILO = { id: '33333333-3333-4333-8333-333333333333', kind: 'silo', name: '03 Silo', radius: 2.95, coneAngle: 35, currentHeight: 4, fillState: 'peak', openingStock: 0 };
const QUALITY = { cropYear: '2026/27', grade: 'APH1', moisturePct: 11.2, proteinPct: 11.5, screeningsPct: 1.1, testWeightKgHl: 78.4, fallingNumber: 420 };

const rowOf = (storage) => stateToRows(stateWith(storage), FARM).storages[0];
const backOf = (storage) => rowsToState(stateToRows(stateWith(storage), FARM)).years['2026'].storages[0];

console.log('\n=== recorded quality survives ===');

check('every quality value goes to its column', () => {
  const r = rowOf({ ...SILO, ...QUALITY });
  assert.equal(r.crop_year, '2026/27');
  assert.equal(r.grade, 'APH1');
  assert.equal(r.moisture_pct, 11.2);
  assert.equal(r.protein_pct, 11.5);
  assert.equal(r.screenings_pct, 1.1);
  assert.equal(r.test_weight_kg_hl, 78.4);
  assert.equal(r.falling_number, 420);
});
check('and comes back as it went, to the same keys the screen reads', () => {
  const b = backOf({ ...SILO, ...QUALITY });
  for (const [k, v] of Object.entries(QUALITY)) assert.equal(b[k], v, k);
});
check('the database hands numbers back as strings, and they are read as numbers', () => {
  const rows = stateToRows(stateWith({ ...SILO, ...QUALITY }), FARM);
  rows.storages[0].moisture_pct = '11.20';
  rows.storages[0].falling_number = '420.0';
  const b = rowsToState(rows).years['2026'].storages[0];
  assert.strictEqual(b.moisturePct, 11.2);
  assert.strictEqual(b.fallingNumber, 420);
});
check('a value left blank is null, not zero', () => {
  const b = backOf({ ...SILO, cropYear: '2026/27', grade: 'APH1', moisturePct: null, proteinPct: '' });
  assert.equal(b.moisturePct, null);
  assert.equal(b.proteinPct, null);
  assert.equal(b.screeningsPct, null);
});
check('a genuine zero is kept (0% screenings is a result, not a blank)', () => {
  const r = rowOf({ ...SILO, ...QUALITY, screeningsPct: 0 });
  assert.strictEqual(r.screenings_pct, 0);
});

console.log('\n=== a storage with nothing recorded is untouched ===');

check('it sends none of the new columns, so a database that has not had the migration still accepts it', () => {
  const r = rowOf(SILO);
  for (const c of COLUMNS) assert.ok(!(c in r), `${c} should not be sent`);
});
check('and comes back with no quality keys, so a round trip changes nothing', () => {
  const b = backOf(SILO);
  for (const k of Object.keys(QUALITY)) assert.ok(!(k in b), `${k} should not appear`);
  assert.ok(!('__hasQuality' in b));
});
check('empty strings and nulls count as nothing recorded', () => {
  assert.equal(hasStorageQuality({ cropYear: '', grade: '', moisturePct: null }), false);
  assert.equal(hasStorageQuality({ moisturePct: 0 }), true);
  assert.equal(hasStorageQuality({ grade: 'APH1' }), true);
});

console.log('\n=== clearing a value reaches the server ===');

check('a storage that has had quality recorded keeps sending the columns, as nulls once cleared', () => {
  const r = rowOf({ ...SILO, cropYear: '', grade: '', moisturePct: null, proteinPct: null, screeningsPct: null, testWeightKgHl: null, fallingNumber: null, __hasQuality: true });
  for (const c of COLUMNS) assert.ok(c in r && r[c] === null, `${c} should be sent as null`);
});

console.log('\n=== the migration matches the mapping ===');

check('every column the app sends is added by a migration', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const sql = readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n');
  for (const c of COLUMNS) assert.ok(new RegExp(`add column if not exists ${c}\\b`).test(sql), `no migration adds storages.${c}`);
});
check('the quality columns live on storages, not on a table with tighter permissions', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261111120000_storage_quality.sql', import.meta.url), 'utf8');
  assert.ok(/alter table storages/.test(sql));
});

console.log('');
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('ALL PASS');
