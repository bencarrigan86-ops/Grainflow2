#!/usr/bin/env node
//
// Does anything the app saves get silently dropped on the way to the server?
//
//   node tests/roundtrip.test.mjs
//
// Three times now a field has existed in the app, had no column in the schema,
// and been quietly discarded by mapping.js: no error, no warning, the value
// simply not there after the next hydrate. Soil test nitrogen, starter
// fertiliser and the dated urea applications all went that way — entered on a
// paddock, pushed, and gone.
//
// A hand-written fixture cannot catch this, because I write the fixture from
// the same assumption that produced the gap. So this test does not use one. It
// reads the object literals the views actually pass to db.upsertField(),
// db.upsertStorage() and the rest, fills every key it finds with a marker
// value, sends that through stateToRows() and back through rowsToState(), and
// reports anything that did not survive.
//
// The app's own source is the specification. Nothing here is my opinion about
// what a paddock has on it.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';
import { ALLOWED } from '../docs/js/import.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FARM = '11111111-1111-1111-1111-111111111111';

let failures = 0;
const fail = (m) => { failures += 1; console.log(`  FAIL  ${m}`); };
const pass = (m) => console.log(`  ok    ${m}`);

// --- read the payloads the views actually build -----------------------------

/** Top-level keys of the object literal passed to `db.<call>(` in `src`. */
function payloadKeys(src, call) {
  const keys = new Set();
  let from = 0;
  for (;;) {
    const at = src.indexOf(`db.${call}({`, from);
    if (at === -1) break;
    let i = src.indexOf('{', at);
    let depth = 0;
    let body = '';
    for (; i < src.length; i += 1) {
      const c = src[i];
      if (c === '{' || c === '[' || c === '(') depth += 1;
      if (c === '}' || c === ']' || c === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
      body += c;
    }
    // Depth 1 only: `seedRateKgHa:` counts, a key inside a nested object does
    // not — the nested one travels with its parent. The leading brace is
    // dropped first so the object's own keys sit at depth 0; leaving it on put
    // every key one level too deep and the scan silently found nothing, which
    // is a fine illustration of why this test reports a stale scan as a
    // failure rather than as "all clear".
    let d = 0;
    for (const line of body.replace(/^\{/, '').split('\n')) {
      const trimmed = line.trim();
      const m = trimmed.match(/^([A-Za-z_$][\w$]*)\s*:/);
      if (m && d === 0) keys.add(m[1]);
      for (const c of line) {
        if ('{(['.includes(c)) d += 1;
        if ('})]'.includes(c)) d -= 1;
      }
    }
    from = i;
  }
  return [...keys];
}

const view = (f) => readFileSync(join(ROOT, 'docs', 'js', 'views', f), 'utf8');

const ENTITIES = [
  { name: 'field',     call: 'upsertField',     file: 'production.js', list: 'fields' },
  { name: 'storage',   call: 'upsertStorage',   file: 'storage.js',    list: 'storages' },
  { name: 'sale',      call: 'upsertSale',      file: 'sales.js',      list: 'sales' },
  { name: 'movement',  call: 'upsertMovement',  file: 'movements.js',  list: 'movements' },
  { name: 'commodity', call: 'upsertCommodity', file: 'settings.js',   list: 'commodities' },
];

// --- give every key a value the database will accept ------------------------

const uuid = () => crypto.randomUUID();

function markerFor(key, ids) {
  if (key === 'id') return ids.self;
  if (key === 'commodityId') return ids.commodity;
  if (key === 'correctsId') return null;
  if (key === 'saleId') return ids.sale;
  if (key === 'kind') return ALLOWED.storageKind[0];
  if (key === 'fillState') return ALLOWED.fillState[2];        // the awkward one
  if (key === 'yieldMode') return ALLOWED.yieldMode[1];
  if (key === 'weightStatus') return ALLOWED.weightStatus[1];
  if (key === 'status') return ALLOWED.movementStatus[1];
  if (key === 'froms') return [{ type: 'field', id: ids.field, tons: 11.5 }];
  if (key === 'tos') return [{ type: 'silo', id: ids.storage, tons: 11.5 }];
  if (key === 'ureaApplications') return [{ date: '2026-06-01', kgHa: 90 }];
  if (key === 'date' || key.endsWith('Date')) return '2026-06-01';
  if (key === 'ticketNo' || key === 'invoiceNo') return 41;
  // A few the suffix rule below cannot see: the quantity word is in the middle
  // of the name, and widening the pattern to catch them would also turn
  // seedVariety and brokerNote into numbers.
  if (['tonsDelivered', 'balesPerRoundBale'].includes(key)) return 7.25;

  // Anything that reads like a quantity gets a number. Getting this wrong does
  // not produce a false alarm — a value that comes back coerced is reported
  // separately from one that comes back missing — but it keeps the output
  // honest about which is which.
  if (/(kgha|tha|ha|rate|tons|price|height|radius|angle|weight|no|days|stock|cost|overhang|width|length|capacity|ratio|pertonne|pct|repose|freight|discount|ginning|levies|seed|bales)$/i
        .test(key)) {
    return 7.25;
  }
  return `marker-${key}`;
}

/** Ignore the hidden ids mapping.js deliberately carries back on legs. */
const stripHidden = (v) => JSON.parse(JSON.stringify(v), (k, val) =>
  (k.startsWith('__') ? undefined : val));

function buildState() {
  const ids = {
    commodity: uuid(), field: uuid(), storage: uuid(), sale: uuid(),
    movement: uuid(), self: null,
  };
  const built = {};
  for (const e of ENTITIES) {
    const keys = payloadKeys(view(e.file), e.call);
    if (!keys.length) { fail(`${e.name}: found no db.${e.call}({...}) payload — the scan has gone stale`); continue; }
    ids.self = ids[e.name] ?? uuid();
    const obj = {};
    for (const k of keys) obj[k] = markerFor(k, ids);
    obj.id = ids[e.name];
    built[e.name] = { keys, obj };
  }

  const state = {
    version: 2, currentYear: '2026',
    businessDetails: { entityName: 'Marker Farms', paymentTermsDays: 30 },
    years: {
      2026: {
        commodities: [built.commodity.obj],
        fields: [built.field.obj],
        storages: [built.storage.obj],
        sales: [built.sale.obj],
        movements: [built.movement.obj],
        invoices: [],
        overheads: {
          finance: 1, equipmentRepayments: 2, depreciation: 3, wages: 4, drawings: 5,
          admin: 6, energy: 7, insurance: 8, repairsMaintenance: 9, other: 10,
        },
      },
    },
  };
  return { state, built };
}

// --- run it -----------------------------------------------------------------

console.log('\n--- what the app saves vs what survives a trip to the server ---');

const { state, built } = buildState();
const rows = stateToRows(state, FARM);
const back = rowsToState(rows);
const year = back.years['2026'];

const listOf = { field: 'fields', storage: 'storages', sale: 'sales', movement: 'movements', commodity: 'commodities' };

for (const e of ENTITIES) {
  const b = built[e.name];
  if (!b) continue;
  const before = b.obj;
  const after = (year?.[listOf[e.name]] || [])[0];

  if (!after) { fail(`${e.name}: nothing came back at all`); continue; }

  // Two different outcomes, and only one of them is a data-loss bug:
  //
  //   missing  the key is not there at all — no column, no mapping, gone
  //   changed  it came back as something else, which is almost always this
  //            test putting a word where the app puts a number
  //
  // Conflating them would bury six real losses in twenty cosmetic ones.
  const missing = [];
  const changed = [];
  for (const k of b.keys) {
    const want = before[k];
    if (want === null || want === undefined) continue;
    const got = after[k];
    if (got === undefined) { missing.push(k); continue; }
    if (JSON.stringify(stripHidden(got)) !== JSON.stringify(stripHidden(want))) {
      changed.push(`${k} (sent ${JSON.stringify(want)}, got ${JSON.stringify(got)})`);
    }
  }

  if (missing.length) {
    fail(`${e.name}: ${missing.length} of ${b.keys.length} saved values are DROPPED — ${missing.join(', ')}`);
  }
  // A value that comes back as 0 or '' instead of what was sent is lost just
  // as thoroughly as one that comes back undefined — arguably worse, because
  // it looks like a real reading. Removing a line from the mapping turns a
  // number into 0, not into undefined, so this has to fail too. The markers
  // above are typed to match the app so that any mismatch here is a fault and
  // not this test's own sloppiness.
  if (changed.length) {
    fail(`${e.name}: ${changed.length} value(s) come back altered`);
    for (const c of changed) console.log(`          - ${c}`);
  }
  if (!missing.length && !changed.length) {
    pass(`${e.name}: all ${b.keys.length} saved values survive intact`);
  }
}

console.log('');
if (failures) {
  console.log(`${failures} FAILURE(S). A value that does not survive is not an error anywhere —`);
  console.log('it is simply absent after the next sync. Add the column, then the mapping.');
  process.exit(1);
}
console.log('Nothing the app saves is dropped in transit.');
