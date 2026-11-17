#!/usr/bin/env node
//
// Every way the startup decision can go, including the one that lost a day.
//
//   node tests/boot.test.mjs

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { chooseBootState, canOpenFromDevice } from '../docs/js/boot.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); }
  catch (e) { failures += 1; console.log(`  FAIL  ${name}\n         ${e.message}`); }
};

const FARM = 'farm-a';
const OTHER = 'farm-b';
const season = (n) => ({ years: { 2026: { fields: Array.from({ length: n }) } } });

console.log('\n=== unsent local work is never overwritten ===');

check('a paddock full of tickets beats a newer-looking server', () => {
  const d = chooseBootState({
    farmId: FARM, localState: season(40), localFarm: FARM, pending: 1,
    serverState: season(500),
  });
  assert.equal(d.use, 'local');
  assert.equal(d.pushLocal, true);
});

check('and it is pushed rather than just kept', () => {
  const d = chooseBootState({
    farmId: FARM, localState: season(3), localFarm: FARM, pending: 7, serverState: null,
  });
  assert.equal(d.use, 'local');
  assert.equal(d.pushLocal, true);
});

console.log('\n=== the failure that started this ===');

check("an import held on a device that never finished starting up is not lost", () => {
  // The exact shape of what happened: unsent work on the device, a server copy
  // that still holds an old test farm. The server must not win.
  const d = chooseBootState({
    farmId: FARM, localState: season(112), localFarm: FARM, pending: 1,
    serverState: season(1),
  });
  assert.equal(d.use, 'local', 'the server would have replaced the import');
});

check('unsent work for another farm is set aside, not adopted', () => {
  const d = chooseBootState({
    farmId: FARM, localState: season(112), localFarm: OTHER, pending: 1,
    serverState: season(2),
  });
  assert.equal(d.use, 'server');
  assert.equal(d.orphan, true, 'it must be preserved and reported');
  assert.equal(d.pushLocal, false, "and never pushed into someone else's farm");
});

check('set aside even when there is no server copy to fall back to', () => {
  const d = chooseBootState({
    farmId: FARM, localState: season(9), localFarm: OTHER, pending: 3, serverState: null,
  });
  assert.equal(d.use, 'fresh');
  assert.equal(d.orphan, true);
});

console.log('\n=== ordinary startups ===');

check('nothing owed: the server wins', () => {
  const d = chooseBootState({
    farmId: FARM, localState: season(2), localFarm: FARM, pending: 0, serverState: season(80),
  });
  assert.equal(d.use, 'server');
  assert.equal(d.orphan, false);
});

check('offline with a local copy: the device wins', () => {
  const d = chooseBootState({
    farmId: FARM, localState: season(80), localFarm: FARM, pending: 0, serverState: null,
  });
  assert.equal(d.use, 'local');
  assert.equal(d.pushLocal, false);
});

check('a brand new account starts clean', () => {
  const d = chooseBootState({ farmId: FARM, localState: null, pending: 0, serverState: null });
  assert.equal(d.use, 'fresh');
});

check('an empty server farm is not mistaken for a populated one', () => {
  const d = chooseBootState({
    farmId: FARM, localState: season(5), localFarm: FARM, pending: 0,
    serverState: { years: {} },
  });
  assert.equal(d.use, 'local', 'no seasons on the server is a new account, not a wipe');
});

console.log('\n=== copies written before stamping existed ===');

check('an unstamped copy is used when the server cannot be reached', () => {
  const d = chooseBootState({
    farmId: FARM, localState: season(30), localFarm: null, pending: 0,
    serverState: null, serverReachable: false,
  });
  assert.equal(d.use, 'local', 'upgrading mid-season in a paddock must not strand anyone');
});

check('but an unstamped copy is NOT poured into a new, empty account', () => {
  // Signing in as a different user on the same laptop. The server answers and
  // says this farm has no seasons — that is an answer, not silence. Adopting
  // the copy left by the previous account would push one farm's records into
  // another's, and it would look like a successful startup.
  const d = chooseBootState({
    farmId: FARM, localState: season(30), localFarm: null, pending: 0,
    serverState: { years: {} }, serverReachable: true,
  });
  assert.equal(d.use, 'fresh');
  assert.equal(d.pushLocal, false);
});

check('but the server still wins over an unstamped copy that owes nothing', () => {
  const d = chooseBootState({
    farmId: FARM, localState: season(30), localFarm: null, pending: 0, serverState: season(30),
  });
  assert.equal(d.use, 'server');
});

console.log('\n=== another farm on a shared device ===');

check("a colleague's saved farm is neither adopted nor deleted", () => {
  const d = chooseBootState({
    farmId: FARM, localState: season(60), localFarm: OTHER, pending: 0, serverState: null,
  });
  assert.equal(d.use, 'fresh');
  assert.equal(d.orphan, false, 'nothing is owed, so nothing needs rescuing');
});

console.log('\n=== every decision is explained ===');

check('no path returns without a reason', () => {
  const cases = [];
  for (const localState of [null, season(1)]) {
    for (const localFarm of [null, FARM, OTHER]) {
      for (const pending of [0, 2]) {
        for (const serverState of [null, { years: {} }, season(1)]) {
          cases.push({ farmId: FARM, localState, localFarm, pending, serverState });
        }
      }
    }
  }
  for (const c of cases) {
    const d = chooseBootState({ ...c, serverReachable: c.serverState !== null });
    assert.ok(['local', 'server', 'fresh'].includes(d.use), `bad use for ${JSON.stringify(c)}`);
    assert.ok(d.reason && d.reason.length > 10, `no reason for ${JSON.stringify(c)}`);
    assert.equal(typeof d.pushLocal, 'boolean');
    assert.equal(typeof d.orphan, 'boolean');
  }
  console.log(`         (${cases.length} combinations)`);
});

check('local is never pushed into a farm it does not belong to', () => {
  for (const pending of [0, 1, 5]) {
    for (const serverState of [null, season(1)]) {
      const d = chooseBootState({
        farmId: FARM, localState: season(1), localFarm: OTHER, pending, serverState,
      });
      assert.equal(d.pushLocal, false);
    }
  }
});

check('unsent work is never silently discarded', () => {
  // Whatever else happens, pending work either wins or is flagged for rescue.
  for (const localFarm of [FARM, OTHER]) {
    for (const serverState of [null, season(3)]) {
      const d = chooseBootState({
        farmId: FARM, localState: season(4), localFarm, pending: 1, serverState,
      });
      assert.ok(d.use === 'local' || d.orphan,
        `pending work dropped for localFarm=${localFarm}`);
    }
  }
});

console.log('\n=== opening at once from this device ===');

const seasoned = { years: { 2026: { __seasonId: 's1', fields: [] }, 2025: { __seasonId: 's0', fields: [] } } };
const open = (o = {}) => canOpenFromDevice({ farmId: FARM, localState: seasoned, localFarm: FARM, pending: 0, legacy: 0, online: true, ...o });

check('a device holding this farm and owing nothing opens from its own copy', () => {
  assert.equal(open(), true);
});

check('anything that needs the server first still waits for it', () => {
  assert.equal(open({ pending: 1 }), false, 'unsent changes: the existing rules decide');
  assert.equal(open({ legacy: 2 }), false, 'old whole-farm markers settle against the server copy');
  assert.equal(open({ online: false }), false, 'offline already opens from the device by the existing rule');
  assert.equal(open({ localState: null }), false);
  assert.equal(open({ localFarm: OTHER }), false, 'a copy of a different farm is never used');
  assert.equal(open({ localFarm: null }), false, "an unstamped copy could be anyone's");
  assert.equal(open({ localState: { years: {} } }), false, 'no seasons yet');
  assert.equal(open({ localState: { years: { 2026: { fields: [] } } } }), false, 'a season with no server id needs the server to give it one');
});

check('startup uses it, and reads the server straight after', () => {
  const st = readFileSync(new URL('../docs/js/storage.js', import.meta.url), 'utf8');
  assert.ok(st.includes('const fromDevice = canOpenFromDevice('));
  assert.ok(st.includes('if (navigator.onLine && !fromDevice) {'), 'the blocking download is skipped only then');
  const main = readFileSync(new URL('../docs/js/main.js', import.meta.url), 'utf8');
  assert.ok(/renderYearPill\(\);\s*\/\/ The farm opened from this device/.test(main), 'main reads the server right after the first paint');
  assert.ok(/if \(db\.openedFromDevice\(\)\) refreshIfQuiet\(\{ force: true \}\);\s*\}\s*\/\*\*\s*\* Support looking at a farm/.test(main));
  assert.ok(main.includes('setTimeout(() => refreshIfQuiet(), 5000);'), 'the later look is skipped when that one has just run');
});

console.log('');
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('ALL PASS');
