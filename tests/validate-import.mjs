#!/usr/bin/env node
//
// Check a Grainflow backup file before importing it.
//
//   node tests/validate-import.mjs path/to/grainflow-backup.json
//
// Reads only. Nothing is written, uploaded, or sent anywhere — the file stays
// on this machine. Run it on a real backup before letting the app near it.

import { readFileSync } from 'node:fs';
import { prepareImport } from '../docs/js/import.js';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node tests/validate-import.mjs <backup.json>');
  process.exit(2);
}

let raw;
try {
  raw = readFileSync(path, 'utf8');
} catch (e) {
  console.error(`Could not read ${path}: ${e.message}`);
  process.exit(2);
}

let result;
try {
  result = prepareImport(raw);
} catch (e) {
  console.error(`That file is not valid JSON: ${e.message}`);
  process.exit(1);
}

const { before, after, remapped, filled, state } = result;
const bytes = Buffer.byteLength(raw, 'utf8');

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

console.log('\n=== what is in the file ===');
console.log(`  file size            ${kb(bytes)}`);
for (const [k, v] of Object.entries(after.stats)) {
  if (k === 'photoBytes') continue;
  console.log(`  ${k.padEnd(20)} ${v}`);
}
if (after.stats.photos) {
  console.log(`  photos are ${kb(after.stats.photoBytes)} of that — they upload to`);
  console.log('  object storage on first sync, not into the rows.');
}

console.log('\n=== ids ===');
console.log(`  ${remapped} id(s) reissued as UUIDs`);
if (before.problems.length && !after.problems.length) {
  console.log('  the original file would have been rejected by the database;');
  console.log('  after remapping it is accepted.');
} else if (!remapped) {
  console.log('  already UUIDs — nothing to change.');
}

if (filled?.length) {
  console.log('\n=== sections this file predates ===');
  console.log('  Not present in the file, added empty because the current app');
  console.log('  reads them. No values were invented.');
  for (const f of filled) console.log(`  + ${f}`);
}

// Which keys the file actually carries, per record type.
//
// "It did not come through" has two completely different causes — the value was
// never in the file, or the file had it and something downstream dropped it —
// and no amount of reasoning about the code can tell them apart. This reads the
// file and says which.
{
  const LISTS = [
    ['paddocks', 'fields'], ['storages', 'storages'], ['contracts', 'sales'],
    ['movements', 'movements'], ['commodities', 'commodities'],
  ];
  console.log('\n=== what each record in the file actually carries ===');
  for (const [label, key] of LISTS) {
    const rows = Object.values(state.years || {}).flatMap((y) => y[key] || []);
    if (!rows.length) { console.log(`  ${label}: none in this file`); continue; }
    const counts = new Map();
    for (const r of rows) {
      for (const [k, v] of Object.entries(r)) {
        if (k.startsWith('__')) continue;
        const set = v !== null && v !== undefined && v !== ''
          && !(Array.isArray(v) && v.length === 0);
        if (set) counts.set(k, (counts.get(k) || 0) + 1);
        else if (!counts.has(k)) counts.set(k, 0);
      }
    }
    console.log(`  ${label} (${rows.length}):`);
    for (const [k, c] of [...counts].sort()) {
      console.log(`      ${c ? String(c).padStart(4) : '   -'}  ${k}`);
    }
  }
  console.log('\n  A dash means the key exists on no record with a value in it.');
  console.log('  A key absent from this list is not in the file at all — in which');
  console.log('  case no amount of fixing the app will bring it back, and it has');
  console.log('  to come from wherever it still exists.');
}

const show = (title, list) => {
  if (!list.length) return;
  console.log(`\n=== ${title} (${list.length}) ===`);
  for (const p of list.slice(0, 40)) console.log(`  ${p}`);
  if (list.length > 40) console.log(`  … and ${list.length - 40} more`);
};

show('problems — these would be rejected', after.problems);
show('warnings — these would import, but look odd', after.warnings);

console.log('');
if (after.ok) {
  console.log('READY. Every value satisfies the database constraints.');
  console.log('Seasons: ' + Object.keys(state.years).join(', '));
  process.exit(0);
} else {
  console.log('NOT READY. Fix the problems above before importing.');
  process.exit(1);
}
