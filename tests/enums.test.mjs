#!/usr/bin/env node
//
// Hold three vocabularies against each other and fail if they drift apart:
//
//   1. the database          — check constraints in supabase/migrations
//   2. the validator         — ALLOWED in docs/js/import.js
//   3. the app               — the literal values the UI actually writes
//
// This test exists because that drift has now bitten twice, and both times it
// got through a green suite:
//
//   ref_type    app wrote 'silo',    schema accepted 'storage'
//   fill_state  app wrote 'decline', schema accepted 'level'
//
// Neither was caught by a unit test, because the unit tests used fixtures I
// wrote — so they tested my assumption about the app's data against my
// assumption about the schema, and agreed with themselves. The only honest
// source for what the app writes is the app's own source, and the only honest
// source for what the database accepts is the migration files. So read both.
//
//   node tests/enums.test.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWED } from '../docs/js/import.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
let checks = 0;
const fail = (msg) => { failures += 1; console.log(`  FAIL  ${msg}`); };
const pass = (msg) => { checks += 1; console.log(`  ok    ${msg}`); };

// ---------------------------------------------------------------------------
// 1. What the database accepts
// ---------------------------------------------------------------------------

/**
 * Read every migration in order and work out the live check constraint for
 * each (table, column). Later migrations override earlier ones, which is the
 * whole point — a fix applied by ALTER has to win over the CREATE TABLE it
 * corrects, or this test would keep asserting the bug.
 */
function schemaVocabularies() {
  const out = new Map();                    // "table.column" -> string[]
  const dir = join(ROOT, 'supabase', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  const values = (list) =>
    [...list.matchAll(/'([^']*)'/g)].map((m) => m[1]);

  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8')
      // Strip line comments so a constraint quoted in a comment is not read as
      // real. The comments in these migrations quote old constraints verbatim.
      .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

    // Inline column checks inside CREATE TABLE.
    let table = null;
    for (const line of sql.split('\n')) {
      const create = line.match(/^\s*create table (?:if not exists )?(\w+)\s*\(/i);
      if (create) { table = create[1]; continue; }
      if (/^\s*\)\s*;/.test(line)) { table = null; continue; }
      if (!table) continue;
      const chk = line.match(/check \(\s*(\w+) in \(([^)]*)\)\s*\)/i);
      if (chk) out.set(`${table}.${chk[1]}`, values(chk[2]));
    }

    // ALTER TABLE ... ADD CONSTRAINT ... CHECK (col in (...)).
    const alterRe =
      /alter table (\w+)\s+add\s+constraint\s+\w+\s+check \(\s*(\w+) in \(([^)]*)\)\s*\)/gi;
    for (const m of sql.matchAll(alterRe)) {
      out.set(`${m[1]}.${m[2]}`, values(m[3]));
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// 2. What the validator allows, expressed in database terms
// ---------------------------------------------------------------------------

// mapping.js translates the app's leg vocabulary on the way to the database.
// Kept as a literal rather than imported because import.js must stay free of
// browser-side imports, and because writing it out is the point: if this map
// and mapping.js disagree, one of the two is wrong and the test below says so.
const REF_TYPE_TO_DB = { silo: 'storage', field: 'field', sale: 'sale' };

const EXPECTED = {
  'storages.kind':            ALLOWED.storageKind,
  'storages.fill_state':      ALLOWED.fillState,
  'field_agronomy.yield_mode': ALLOWED.yieldMode,
  'movements.status':         ALLOWED.movementStatus,
  'movements.weight_status':  ALLOWED.weightStatus,
  'movement_legs.direction':  ALLOWED.direction,
  'movement_legs.ref_type':   ALLOWED.refType.map((t) => REF_TYPE_TO_DB[t] ?? t),
  'invoices.status':          ALLOWED.invoiceStatus,
};

// ---------------------------------------------------------------------------
// 3. What the app actually writes
// ---------------------------------------------------------------------------

function appSources() {
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.js')) files.push(p);
    }
  };
  walk(join(ROOT, 'docs', 'js'));
  return files.map((p) => [p.slice(ROOT.length + 1), readFileSync(p, 'utf8')]);
}

// Each entry: the field, and the patterns that produce one of its values.
//
// Segmented-button groups (`data-fill="peak"`) are how these are chosen in the
// UI, and object-literal assignment is how they are saved, so between them the
// two patterns cover every value that can reach storage. Deliberately narrow —
// a scan that matches `type: 'number'` on a form field would cry wolf, and a
// test people learn to ignore is worse than no test.
//
// `files` narrows a group to the views that own that field. Both the storage
// editor and the movement editor render a segmented group called data-kind,
// and they mean different things: one picks what a store *is*, the other picks
// what a leg *points at*. Scanning them together reported the movement picker
// as an illegal storage kind — a false alarm, and the fastest way to teach
// someone to stop reading the output.
const APP_PATTERNS = [
  { key: 'fillState', allowed: ALLOWED.fillState, patterns: [
    /data-fill="([a-z]+)"/g,
    /fillState\s*(?::|===|==|=)\s*'([a-z]+)'/g,
  ] },
  { key: 'storage kind', allowed: ALLOWED.storageKind, files: /views\/storage\.js$/, patterns: [
    /data-kind="([a-z]+)"/g,
  ] },
  { key: 'movement leg type', allowed: ALLOWED.refType, files: /views\/movements\.js$/, patterns: [
    /data-kind="([a-z]+)"/g,
  ] },
  { key: 'weightStatus', allowed: ALLOWED.weightStatus, patterns: [
    /weightStatus\s*(?::|===|==|=)\s*'([a-z]+)'/g,
  ] },
  { key: 'yieldMode', allowed: ALLOWED.yieldMode, patterns: [
    /yieldMode\s*(?::|===|==|=)\s*'([a-z]+)'/g,
  ] },
  { key: 'invoice status', allowed: ALLOWED.invoiceStatus, patterns: [
    /status:\s*'(outstanding|paid|[a-z]+)'\s*,\s*paidDate/g,
  ] },
];

// ---------------------------------------------------------------------------

const same = (a, b) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

console.log('\n--- database vs validator ---');
const schema = schemaVocabularies();
for (const [col, expect] of Object.entries(EXPECTED)) {
  const actual = schema.get(col);
  if (!actual) {
    fail(`${col}: no check constraint found in supabase/migrations`);
  } else if (!same(actual, expect)) {
    fail(`${col}: database accepts [${actual.join(', ')}], validator allows [${expect.join(', ')}]`);
  } else {
    pass(`${col} — ${actual.join(', ')}`);
  }
}

console.log('\n--- app vs validator ---');
const sources = appSources();
for (const { key, allowed, patterns, files } of APP_PATTERNS) {
  const found = new Map();                  // value -> where
  for (const [name, src] of sources) {
    if (files && !files.test(name.replace(/\\/g, '/'))) continue;
    for (const re of patterns) {
      for (const m of src.matchAll(re)) {
        if (!found.has(m[1])) found.set(m[1], name);
      }
    }
  }
  if (!found.size) {
    fail(`${key}: found no occurrences in docs/js — the pattern has gone stale`);
    continue;
  }
  const bad = [...found].filter(([v]) => !allowed.includes(v));
  if (bad.length) {
    for (const [v, where] of bad) {
      fail(`${key}: app writes "${v}" (${where}) — not in [${allowed.join(', ')}]`);
    }
  } else {
    pass(`${key} — app uses ${[...found.keys()].sort().join(', ')}`);
  }
}

console.log('\n--- mapping translation ---');
// mapping.js has to carry the same leg translation this test assumes.
const mapping = readFileSync(join(ROOT, 'docs', 'js', 'mapping.js'), 'utf8');
for (const [app, db] of Object.entries(REF_TYPE_TO_DB)) {
  if (new RegExp(`${app}\\s*:\\s*'${db}'`).test(mapping)) {
    pass(`mapping.js translates ${app} -> ${db}`);
  } else {
    fail(`mapping.js does not translate ${app} -> ${db}`);
  }
}

console.log('');
if (failures) {
  console.log(`${failures} failure(s), ${checks} passed.`);
  process.exit(1);
}
console.log(`All ${checks} checks passed.`);
