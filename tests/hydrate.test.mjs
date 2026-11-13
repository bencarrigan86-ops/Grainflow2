// Run with:
//   node tests/hydrate.test.mjs
//
// Everything the app sends to the server it must also read back.
//
// movement_photos was written by every push and never fetched. Photos uploaded fine, then
// disappeared from the ticket the next time the app refreshed from the server, and could never
// be seen on a second device. Nothing failed anywhere, so nothing said so.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'js');
const sync = readFileSync(join(ROOT, 'sync.js'), 'utf8');
const hydrate = readFileSync(join(ROOT, 'hydrate.js'), 'utf8');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

const listIn = (src, name) => {
  const m = src.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  assert.ok(m, `could not find ${name}`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
};

const pushed = listIn(sync, 'ORDER');
const fetched = listIn(hydrate, 'FARM_SCOPED');

check('the lists were found', () => {
  assert.ok(pushed.length >= 10, `only ${pushed.length} tables pushed`);
  assert.ok(fetched.length >= 10, `only ${fetched.length} tables fetched`);
});
check('every table a push writes is also fetched when the farm is read back', () => {
  const missing = pushed.filter((t) => !fetched.includes(t));
  assert.deepEqual(missing, [], `written but never read back: ${missing.join(', ')}`);
});
check('photos in particular', () => {
  assert.ok(fetched.includes('movement_photos'));
});

console.log('\n=== a photo comes back with its ticket ===');

import { stateToRows, rowsToState } from '../docs/js/mapping.js';

const FARM = '11111111-1111-1111-1111-111111111111';
const state = {
  currentYear: '2026', nextMovementNo: 2, businessDetails: {},
  years: { 2026: { commodities: [], fields: [], storages: [], sales: [], invoices: [], overheads: {},
    movements: [{ id: '22222222-2222-2222-2222-222222222222', ticketNo: 1, date: '2026-11-01', froms: [], tos: [], tons: 10, photoPath: 'farm/mov/p.jpg' }] } },
};

check('an uploaded photo is pushed as a photo row', () => {
  assert.equal(stateToRows(state, FARM).movement_photos.length, 1);
});
check('and when the photo rows are read back, the ticket has its photo again', () => {
  const back = rowsToState(stateToRows(state, FARM));
  assert.equal(back.years[2026].movements[0].photoPath, 'farm/mov/p.jpg');
});
check('without the photo rows the photo is gone, which is why they must be fetched', () => {
  const rows = { ...stateToRows(state, FARM), movement_photos: undefined };
  assert.equal(rowsToState(rows).years[2026].movements[0].photoPath, undefined);
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
