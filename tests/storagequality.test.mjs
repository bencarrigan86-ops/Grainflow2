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
import { stateToRows, rowsToState, hasStorageQuality, hasLoadQuality } from '../docs/js/mapping.js';

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

console.log('\n=== quality of a load ===');

const LOAD_COLUMNS = ['grade', 'moisture_pct', 'protein_pct', 'screenings_pct', 'test_weight_kg_hl', 'falling_number'];
const LOAD = { id: '44444444-4444-4444-8444-444444444444', date: '2026-11-05', ticketNo: 7, tons: 36, weightStatus: 'final',
  froms: [{ type: 'field', id: 'f1', tons: 36 }], tos: [{ type: 'silo', id: SILO.id, tons: 36 }] };
const LOAD_QUALITY = { grade: 'APH1', moisturePct: 11.4, proteinPct: 11.9, screeningsPct: 0.8, testWeightKgHl: 79.2, fallingNumber: 410 };
const stateWithLoad = (movement) => ({ ...stateWith(SILO), years: { 2026: { ...stateWith(SILO).years['2026'], movements: [movement] } } });
const loadRow = (m) => stateToRows(stateWithLoad(m), FARM).movements[0];
const loadBack = (m) => rowsToState(stateToRows(stateWithLoad(m), FARM)).years['2026'].movements[0];

check('a load\'s quality goes to its columns and comes back', () => {
  const r = loadRow({ ...LOAD, ...LOAD_QUALITY });
  assert.equal(r.grade, 'APH1');
  assert.equal(r.moisture_pct, 11.4);
  assert.equal(r.protein_pct, 11.9);
  assert.equal(r.screenings_pct, 0.8);
  assert.equal(r.test_weight_kg_hl, 79.2);
  assert.equal(r.falling_number, 410);
  const b = loadBack({ ...LOAD, ...LOAD_QUALITY });
  for (const [k, v] of Object.entries(LOAD_QUALITY)) assert.equal(b[k], v, k);
});
check('a load with nothing recorded sends no quality columns, so loads still save before the migration', () => {
  const r = loadRow(LOAD);
  for (const c of LOAD_COLUMNS) assert.ok(!(c in r), `${c} should not be sent`);
  const b = loadBack(LOAD);
  for (const k of Object.keys(LOAD_QUALITY)) assert.ok(!(k in b), `${k} should not appear`);
});
check('a load has no crop year of its own', () => {
  assert.ok(!('crop_year' in loadRow({ ...LOAD, ...LOAD_QUALITY, cropYear: '26/27' })));
});
check('a load whose quality was cleared still sends nulls, so the clearing reaches the server', () => {
  const r = loadRow({ ...LOAD, grade: '', moisturePct: null, __hasQuality: true });
  for (const c of LOAD_COLUMNS) assert.ok(c in r && r[c] === null, c);
});
check('the other system\'s movement number goes to source_ref and comes back; ordinary loads send none', () => {
  assert.equal(loadRow({ ...LOAD, sourceRef: 'M123456' }).source_ref, 'M123456');
  assert.equal(loadBack({ ...LOAD, sourceRef: 'M123456' }).sourceRef, 'M123456');
  assert.ok(!('source_ref' in loadRow(LOAD)));
  assert.ok(!('sourceRef' in loadBack(LOAD)));
});
check('hasLoadQuality sees a value, and a zero, and ignores blanks', () => {
  assert.equal(hasLoadQuality({ proteinPct: 0 }), true);
  assert.equal(hasLoadQuality({ grade: '', moisturePct: null }), false);
});

console.log('\n=== running samples, by tonnes ===');

check('bands and their date go to one column and come back, in order', () => {
  const bands = [
    { tons: 500, grade: 'APH1' },
    { tons: 250, grade: 'AUH2', proteinPct: 11.5, moisturePct: 11, screeningsPct: 1.1, testWeightKgHl: 79, fallingNumber: 400 },
  ];
  const r = rowOf({ ...SILO, gradeBands: bands, gradeBandsDate: '2026-11-12' });
  assert.deepEqual(r.grade_bands, { asOf: '2026-11-12', bands });
  const back = backOf({ ...SILO, gradeBands: bands, gradeBandsDate: '2026-11-12' });
  assert.deepEqual(back.gradeBands, bands);
  assert.equal(back.gradeBandsDate, '2026-11-12');
});
check('a silo with none sends no column, so silos still save before the migration', () => {
  assert.ok(!('grade_bands' in rowOf(SILO)));
  assert.ok(!('gradeBands' in backOf(SILO)));
  assert.ok(!('grade_bands' in rowOf({ ...SILO, gradeBands: [] })));
});
check('bands that were cleared still send a null, so the clearing reaches the server', () => {
  const r = rowOf({ ...SILO, gradeBands: [], __hasBands: true });
  assert.ok('grade_bands' in r && r.grade_bands === null);
});

console.log('\n=== notes on a storage ===');

check('a note goes to the notes column and comes back', () => {
  const r = rowOf({ ...SILO, notes: 'Auger sticks on the east side' });
  assert.equal(r.notes, 'Auger sticks on the east side');
  assert.equal(backOf({ ...SILO, notes: 'Auger sticks on the east side' }).notes, 'Auger sticks on the east side');
});
check('a storage with no note sends no notes column, and comes back without one', () => {
  assert.ok(!('notes' in rowOf(SILO)));
  assert.ok(!('notes' in backOf(SILO)));
  assert.ok(!('notes' in rowOf({ ...SILO, notes: '   ' })), 'spaces are not a note');
});
check('a note that is deleted still reaches the server, as null', () => {
  const r = rowOf({ ...SILO, notes: '', __hasNotes: true });
  assert.ok('notes' in r && r.notes === null);
});

console.log('\n=== the second migration matches ===');

check('every load and note column the app sends is added by a migration', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const sql = readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n');
  const movementsPart = sql.slice(sql.indexOf('alter table movements'));
  for (const c of LOAD_COLUMNS) assert.ok(new RegExp(`add column if not exists ${c}\\b`).test(movementsPart), `no migration adds movements.${c}`);
  assert.ok(/alter table storages\s+add column if not exists notes text/.test(sql), 'no migration adds storages.notes');
});

console.log('');
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('ALL PASS');
