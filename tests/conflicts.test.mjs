#!/usr/bin/env node
//
// What the push treats as "the same row".
//
//   node tests/conflicts.test.mjs
//
// A phone sat seven changes behind for a day and gave no sign of it. Every
// push was refused with
//
//     duplicate key value violates unique constraint "sale_terms_sale_id_key"
//
// because sale_terms holds one row per sale and says so with a unique
// constraint, while the push upserted on the primary key. A device whose copy
// of a sale had lost its __termsId minted a fresh UUID on every attempt, so the
// insert collided with the row already there, failed, minted another, and
// failed again. Forever.
//
// It was worse than a stuck table. The push stops at the first failure by
// design, and unsent work outranks the server by design, so one wrong conflict
// target meant that phone stopped sending anything AND stopped receiving
// anything, silently. The same fault had already happened once on `seasons`.
//
// So this reads the unique constraints out of the schema and checks the push
// agrees with them — rather than trusting a list in sync.js to stay in step
// with a list in a migration, which is the arrangement that produced 'level'
// for a fill state the app has never written.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';

// sync.js cannot be imported: it pulls supabase-js from a CDN and Node's
// loader will not fetch https. So the two constants are read out of the source,
// the same way tests/sw.test.mjs reads the service worker. Reading the real
// file rather than restating its contents here is the whole point — a copy
// would agree with itself forever.
const syncSrc = readFileSync(new URL('../docs/js/sync.js', import.meta.url), 'utf8');

function literalAfter(name) {
  const at = syncSrc.indexOf(`const ${name} = `);
  if (at === -1) throw new Error(`${name} is no longer declared in sync.js`);
  const start = syncSrc.indexOf('=', at) + 1;
  const open = syncSrc[syncSrc.slice(start).search(/\S/) + start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let i = start; i < syncSrc.length; i += 1) {
    if (syncSrc[i] === open) depth += 1;
    else if (syncSrc[i] === close) {
      depth -= 1;
      if (depth === 0) {
        // eslint-disable-next-line no-new-func
        return new Function(`return ${syncSrc.slice(start, i + 1)}`)();
      }
    }
  }
  throw new Error(`could not read ${name} out of sync.js`);
}

const CONFLICT_KEY = literalAfter('CONFLICT_KEY');
const PUSH_ORDER = literalAfter('ORDER');

const schema = readFileSync(
  new URL('../supabase/migrations/20260831120000_initial_schema.sql', import.meta.url), 'utf8');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); }
  catch (e) { failures += 1; console.log(`  FAIL  ${name}\n         ${e.message}`); }
};

/** Every table in the schema, with the unique constraints declared on it. */
function uniquesByTable() {
  const out = new Map();
  const re = /create table (\w+) \(([\s\S]*?)\n\);/g;
  for (const m of schema.matchAll(re)) {
    const [, table, body] = m;
    const uniques = [...body.matchAll(/^\s*unique \(([^)]*)\)/gm)]
      .map((u) => u[1].split(',').map((c) => c.trim()).join(','));
    // A column marked unique inline, e.g. `token text not null unique`.
    for (const col of body.matchAll(/^\s*(\w+)\s+[\w()]+[^,\n]*\bunique\b/gm)) uniques.push(col[1]);
    out.set(table, uniques);
  }
  return out;
}

const uniques = uniquesByTable();

console.log('\n=== the schema was read ===');

check('the tables and their unique constraints were found', () => {
  assert.ok(uniques.size > 10, `only found ${uniques.size} tables`);
  assert.deepEqual(uniques.get('sale_terms'), ['sale_id']);
  assert.deepEqual(uniques.get('field_agronomy'), ['field_id']);
  assert.deepEqual(uniques.get('overheads'), ['season_id']);
});

console.log('\n=== every conflict target is a real unique constraint ===');

check('each one names a constraint the database actually has', () => {
  // Postgres refuses ON CONFLICT on columns with no matching unique index, so a
  // typo here is not a subtle bug — it is every push failing on that table.
  for (const [table, key] of Object.entries(CONFLICT_KEY)) {
    const declared = uniques.get(table);
    assert.ok(declared, `${table} is not a table in the schema`);
    assert.ok(declared.includes(key),
      `${table} upserts on "${key}", which is not unique there — it has ${JSON.stringify(declared)}`);
  }
});

check('every table named is one the push actually sends', () => {
  for (const table of Object.keys(CONFLICT_KEY)) {
    assert.ok(PUSH_ORDER.includes(table), `${table} is not in the push order`);
  }
});

console.log('\n=== one row per parent must not be upserted on its primary key ===');

check('every strict one-per-parent table has a conflict target', () => {
  // The property that broke. A table whose unique key is a single reference to
  // its parent holds exactly one row per parent, so the parent is its real
  // identity — and a device that has lost the child's id will invent a new one
  // and collide every time.
  const missing = [];
  for (const [table, keys] of uniques) {
    if (!PUSH_ORDER.includes(table)) continue;
    const oneToOne = keys.find((k) => /^\w+_id$/.test(k) && !k.includes(','));
    if (oneToOne && CONFLICT_KEY[table] !== oneToOne) {
      missing.push(`${table} is one row per ${oneToOne} but upserts on ${CONFLICT_KEY[table] || 'id'}`);
    }
  }
  assert.deepEqual(missing, [], `\n         ${missing.join('\n         ')}`);
});

console.log('\n=== the two that are deliberately left alone ===');

check('movements and invoices still upsert on the primary key', () => {
  // Both have a unique constraint — (farm_id, ticket_no) and (farm_id,
  // invoice_no) — and both must NOT use it. Two devices offline can genuinely
  // mint the same ticket number for two different loads; that is why number
  // leasing is still on the list. Upserting on it would quietly merge two real
  // loads into one, which is far worse than a push that stops and says so.
  assert.equal(CONFLICT_KEY.movements, undefined,
    'movements would merge two different loads that share a ticket number');
  assert.equal(CONFLICT_KEY.invoices, undefined,
    'invoices would merge two different invoices that share a number');
  // And they are genuinely the unique-but-unsafe case, not just absent.
  assert.ok(uniques.get('movements').includes('farm_id,ticket_no'));
  assert.ok(uniques.get('invoices').includes('farm_id,invoice_no'));
});

console.log('');
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('ALL PASS');
