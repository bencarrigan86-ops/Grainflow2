#!/usr/bin/env node
//
// The sample farm a trial account starts with.
//
//   node tests/demo.test.mjs
//
// This file is shipped to strangers. Two things could go badly wrong with it,
// and neither would look wrong on screen:
//
//   1. Something real leaks into it. A buyer, a contract price, a bank
//      account. Nobody reviewing a JSON file of 39 movements would spot one
//      real row among them, and by then it is on a prospect's phone.
//
//   2. The ids are UUIDs. Then every trial farm imports the same primary keys
//      and the second person to sign up collides with the first — which fails
//      at the push, long after the screen has said "welcome".
//
// Both are checked here against the file that actually ships, not against the
// generator's intentions.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { prepareImport, isUuid, remapIds } from '../docs/js/import.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';
import { sampleStateFor } from '../docs/js/demo.js';

const raw = readFileSync(new URL('../docs/demo/seed.json', import.meta.url), 'utf8');
const seed = JSON.parse(raw);
const season = seed.years[seed.currentYear];

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); }
  catch (e) { failures += 1; console.log(`  FAIL  ${name}\n         ${e.message}`); }
};

console.log('\n=== nothing real is in it ===');

check('no name, buyer or address from an actual farm appears anywhere', () => {
  // Checked against the raw text rather than the parsed object, so a value
  // hiding in a note, a leg or an invoice line is caught as readily as one in
  // a field the test knows about.
  const forbidden = [
    'Sunnyridge', 'Grassdale', 'Carrigan', 'Mort', 'bencarrigan',
    '@gmail', '@hotmail', 'mvrlvytoplpwglgkxqpp',
  ];
  const lower = raw.toLowerCase();
  for (const word of forbidden) {
    assert.ok(!lower.includes(word.toLowerCase()), `the seed contains "${word}"`);
  }
});

check('there are no bank details, and the fields are present and empty', () => {
  // Present so the shape is right; empty because a sample farm that ships with
  // a BSB in it teaches whoever opens it that this is a normal thing to pass
  // around. The keys must exist — a missing key is a different bug.
  const b = seed.businessDetails;
  for (const key of ['bankName', 'accountName', 'bsb', 'accountNumber']) {
    assert.ok(key in b, `businessDetails.${key} is missing entirely`);
    assert.equal(b[key], '', `businessDetails.${key} is not empty`);
  }
});

check('nothing that looks like a BSB or an account number is anywhere in the file', () => {
  // The belt to the braces above: a real BSB pasted into a note or an address
  // would pass every field-by-field check.
  // The separator is required. Without it the pattern matches any six-digit
  // number and the first version of this test failed on an overheads figure of
  // 186000 — a check that cries wolf on real data gets deleted by whoever hits
  // it next, which is worse than not having it.
  assert.ok(!/\b\d{3}[-\s]\d{3}\b/.test(raw.replace(/"abn":\s*"[^"]*"/g, '')),
    'something in the seed is shaped like a BSB');
  assert.ok(!/\b\d{8,10}\b/.test(raw.replace(/"(abn|ngr)":\s*"[^"]*"/g, '')),
    'something in the seed is shaped like an account number');
});

check('no real email address or phone number', () => {
  assert.ok(!/[\w.+-]+@[\w-]+\.[\w.]+/.test(raw), 'the seed contains an email address');
  assert.equal(seed.businessDetails.phone, '');
});

console.log('\n=== two trials do not collide ===');

check('the ids are readable, not UUIDs', () => {
  // The whole point. remapIds() only reissues ids that are NOT already UUIDs,
  // so baking UUIDs in here would give every trial farm the same primary keys
  // — and the second signup would fail at the push with a duplicate key, after
  // the app had already told them they were in.
  const ids = [
    ...season.commodities, ...season.fields, ...season.storages,
    ...season.sales, ...season.movements, ...season.invoices,
  ].map((r) => r.id);
  assert.ok(ids.length > 50, `only found ${ids.length} ids`);
  const uuids = ids.filter(isUuid);
  assert.deepEqual(uuids, [], `${uuids.length} id(s) are already UUIDs and will not be reissued`);
});

check('importing it twice produces two completely separate sets of ids', () => {
  // The property that matters, tested rather than reasoned about.
  const a = remapIds(seed).state;
  const b = remapIds(seed).state;
  const idsOf = (s) => {
    const y = s.years[s.currentYear];
    return [...y.commodities, ...y.fields, ...y.storages, ...y.sales, ...y.movements, ...y.invoices]
      .map((r) => r.id);
  };
  const setA = new Set(idsOf(a));
  const overlap = idsOf(b).filter((id) => setA.has(id));
  assert.deepEqual(overlap, [], `${overlap.length} id(s) would be inserted twice`);
  assert.ok(idsOf(a).every(isUuid), 'remapping did not produce UUIDs');
});

check('references survive the remap — a paddock still points at its commodity', () => {
  const { state } = remapIds(seed);
  const y = state.years[state.currentYear];
  const commodityIds = new Set(y.commodities.map((c) => c.id));
  for (const f of y.fields) {
    assert.ok(commodityIds.has(f.commodityId), `${f.name} lost its commodity`);
  }
  const storeIds = new Set(y.storages.map((s) => s.id));
  const fieldIds = new Set(y.fields.map((f) => f.id));
  const saleIds = new Set(y.sales.map((s) => s.id));
  for (const m of y.movements) {
    for (const leg of [...m.froms, ...m.tos]) {
      const pool = leg.type === 'field' ? fieldIds : leg.type === 'sale' ? saleIds : storeIds;
      assert.ok(pool.has(leg.id), `ticket ${m.ticketNo} has a ${leg.type} leg pointing nowhere`);
    }
  }
  for (const inv of y.invoices) assert.ok(saleIds.has(inv.saleId), 'an invoice lost its contract');
});

console.log('\n=== the database would accept it ===');

check("the app's own validator passes it with no problems", () => {
  // Not a second opinion written here — the same prepareImport() the Import
  // button calls and the same one Ben runs over a real backup.
  const { after, state } = prepareImport(raw);
  assert.deepEqual(after.problems, [], after.problems.join('\n         '));
  assert.ok(state, 'no state came back');
});

check('it survives a round trip through the sixteen tables', () => {
  const { state } = prepareImport(raw);
  const back = rowsToState(stateToRows(state, '00000000-0000-4000-8000-000000000001'));
  const label = back.currentYear;
  assert.equal(label, state.currentYear);
  const a = state.years[state.currentYear];
  const b = back.years[label];
  for (const list of ['commodities', 'fields', 'storages', 'sales', 'movements', 'invoices']) {
    assert.equal(b[list].length, a[list].length, `${list} changed length`);
  }
  assert.equal(back.businessDetails.farmName, 'Kurrajong Downs');
});

console.log('\n=== it does not rename the farm they just created ===');

check('the sample keeps their name, not Kurrajong Downs', () => {
  // The trap: businessDetails.entityName is what maps to farms.entity_name, so
  // importing the seed verbatim pushes the sample farm's identity straight over
  // the name the person typed thirty seconds earlier. They would name their
  // farm and watch it turn into somebody else's.
  const s = sampleStateFor(raw, "Bob's Farm");
  assert.equal(s.businessDetails.farmName, "Bob's Farm");
  assert.equal(s.businessDetails.entityName, "Bob's Farm");
  assert.ok(!JSON.stringify(s.businessDetails).includes('Kurrajong'),
    'the sample business identity survived into their farm');
});

check('their business details start empty, not filled with invented ones', () => {
  // A plausible-looking ABN sitting in the field is an invitation not to
  // replace it, and an invoice going out with a made-up ABN on it is a worse
  // outcome than a blank.
  const s = sampleStateFor(raw, 'Anything');
  for (const key of ['abn', 'ngr', 'address', 'bsb', 'accountNumber', 'bankName']) {
    assert.equal(s.businessDetails[key], '', `${key} carried a sample value through`);
  }
});

check('the season and every record still come through', () => {
  const s = sampleStateFor(raw, 'Anything');
  assert.equal(s.currentYear, seed.currentYear);
  assert.equal(s.years[s.currentYear].fields.length, season.fields.length);
  assert.equal(s.years[s.currentYear].movements.length, season.movements.length);
});

check('a missing or blank name does not throw', () => {
  for (const name of [undefined, null, '', '   ']) {
    assert.equal(sampleStateFor(raw, name).businessDetails.farmName, '', String(name));
  }
});

console.log('\n=== the numbers agree with each other ===');

check('every load balances: what left equals what arrived', () => {
  for (const m of season.movements) {
    const from = m.froms.reduce((s, l) => s + l.tons, 0);
    const to = m.tos.reduce((s, l) => s + l.tons, 0);
    assert.ok(Math.abs(from - m.tons) < 0.05, `ticket ${m.ticketNo}: froms ${from} vs ${m.tons}`);
    assert.ok(Math.abs(to - m.tons) < 0.05, `ticket ${m.ticketNo}: tos ${to} vs ${m.tons}`);
  }
});

check('no store is carted out of further than it was carted into', () => {
  // A negative silo is the fastest way to make a demo look broken to somebody
  // who knows what they are looking at.
  const net = new Map();
  for (const m of season.movements) {
    for (const l of m.froms) if (l.type === 'silo') net.set(l.id, (net.get(l.id) || 0) - l.tons);
    for (const l of m.tos) if (l.type === 'silo') net.set(l.id, (net.get(l.id) || 0) + l.tons);
  }
  for (const [id, tons] of net) {
    assert.ok(tons >= -0.05, `${id} finishes at ${tons.toFixed(2)} t`);
  }
});

check('nothing is delivered against a contract that was never grown', () => {
  const grown = new Map();
  for (const f of season.fields) {
    grown.set(f.commodityId, (grown.get(f.commodityId) || 0) + f.areaHa * f.yieldTHa);
  }
  const delivered = new Map();
  for (const m of season.movements) {
    if (m.tos.some((l) => l.type === 'sale')) {
      delivered.set(m.commodityId, (delivered.get(m.commodityId) || 0) + m.tons);
    }
  }
  for (const [c, t] of delivered) {
    assert.ok(t <= grown.get(c), `${c}: delivered ${t.toFixed(0)} t, grew ${grown.get(c).toFixed(0)} t`);
  }
});

check('every contract has some tonnage still to run, or is fully delivered', () => {
  for (const s of season.sales) {
    assert.ok(s.tonsDelivered <= s.tons * 1.05 + 0.05,
      `${s.contractNo} is delivered ${s.tonsDelivered} against ${s.tons} contracted`);
    assert.ok(s.tonsDelivered >= 0, `${s.contractNo} has negative deliveries`);
  }
});

check('ticket numbers are unique and the counter continues past them', () => {
  const nos = season.movements.map((m) => m.ticketNo);
  assert.equal(new Set(nos).size, nos.length, 'a ticket number is used twice');
  assert.ok(seed.nextMovementNo > Math.max(...nos),
    'the next ticket number would repeat one already in the file');
});

console.log('\n=== it reads as a sample, and fits on a phone ===');

check('the season says so in its name', () => {
  // So nobody types a real harvest into it and then wonders which season their
  // figures went to. Deleting a season already exists in Settings.
  assert.match(seed.currentYear, /sample/i, `season is called "${seed.currentYear}"`);
});

check('it is a farm you can take in at a glance, not a data dump', () => {
  assert.ok(season.fields.length >= 8 && season.fields.length <= 20,
    `${season.fields.length} paddocks — a hundred rows is impressive and unreadable`);
  assert.ok(season.commodities.length >= 3, 'too few commodities to show the Position screen working');
  assert.ok(season.storages.length >= 4, 'too few stores');
  assert.ok(season.sales.length >= 4, 'too few contracts to show sold against unsold');
  assert.ok(season.movements.length >= 20, 'too few movements for Reports to have anything in it');
});

check('every screen has something on it', () => {
  assert.ok(season.fields.some((f) => f.soilTestNKgHa > 0), 'the Fert report would be empty');
  assert.ok(season.fields.some((f) => f.ureaApplications.length), 'no urea applications to show');
  assert.ok(season.sales.some((s) => s.tonsDelivered > 0), 'nothing delivered — Sales looks untouched');
  assert.ok(season.sales.some((s) => s.tonsDelivered === 0), 'everything delivered — no open position');
  assert.ok(season.invoices.some((i) => i.status === 'paid'), 'no paid invoice');
  assert.ok(season.invoices.some((i) => i.status === 'outstanding'), 'no outstanding invoice');
  assert.ok(Object.values(season.overheads).some((v) => v > 0), 'overheads are all zero');
  const states = new Set(season.storages.map((s) => s.fillState));
  assert.ok(states.size >= 2, 'every store is at the same fill state — one volume formula shown');
});

console.log('');
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('ALL PASS');
