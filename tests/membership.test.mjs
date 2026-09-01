#!/usr/bin/env node
//
// Picking the right membership row.
//
//   node tests/membership.test.mjs
//
// The fault this covers: a driver signed in and was given the owner's role,
// because the query asked for the farm's membership rows and took the first
// one. Every screen the driver then opened came back empty — correctly refused
// by the server — but the tab bar offered the lot.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { pickMembership } from '../docs/js/membership.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); }
  catch (e) { failures += 1; console.log(`  FAIL  ${name}\n         ${e.message}`); }
};

const FARM = 'farm-1';
const row = (userId, role, over = {}) => ({
  user_id: userId, farm_id: FARM, role,
  can_write_production: false, created_at: '2026-08-31T00:00:00Z',
  farms: { entity_name: 'Sunnyridge' },
  ...over,
});

console.log('\n=== the fault that made the tab bar meaningless ===');

check("a driver is not handed the owner's row", () => {
  // Exactly the shape the server returns: everyone on the farm, in whatever
  // order it likes, with the owner first.
  const rows = [row('u-owner', 'owner'), row('u-driver', 'driver')];
  assert.equal(pickMembership(rows, 'u-driver').role, 'driver');
});

check('and not when the driver comes back first either', () => {
  const rows = [row('u-driver', 'driver'), row('u-owner', 'owner')];
  assert.equal(pickMembership(rows, 'u-owner').role, 'owner');
});

check('a farm with five people gives each of them their own role', () => {
  const rows = [
    row('u1', 'owner'), row('u2', 'manager'), row('u3', 'bookkeeper'),
    row('u4', 'farm_worker'), row('u5', 'driver'),
  ];
  const expected = { u1: 'owner', u2: 'manager', u3: 'bookkeeper', u4: 'farm_worker', u5: 'driver' };
  for (const [id, role] of Object.entries(expected)) {
    assert.equal(pickMembership(rows, id).role, role, id);
  }
});

console.log('\n=== nobody gets a membership they do not have ===');

check('a user with no row on this farm gets nothing', () => {
  assert.equal(pickMembership([row('u-owner', 'owner')], 'u-stranger'), null);
});

check('no rows at all is null, not a guess', () => {
  assert.equal(pickMembership([], 'u1'), null);
});

check('a missing user id cannot match anything', () => {
  const rows = [row('u1', 'owner')];
  for (const id of [null, undefined, '']) assert.equal(pickMembership(rows, id), null);
});

check('junk from the server does not throw', () => {
  assert.equal(pickMembership(null, 'u1'), null);
  assert.equal(pickMembership(undefined, 'u1'), null);
  assert.equal(pickMembership([null, undefined], 'u1'), null);
});

console.log('\n=== belonging to more than one farm ===');

check('the oldest membership wins, so the app opens the same farm each time', () => {
  const rows = [
    row('u1', 'driver', { farm_id: 'newer', created_at: '2026-08-31T10:00:00Z' }),
    row('u1', 'owner',  { farm_id: 'older', created_at: '2026-01-04T09:00:00Z' }),
  ];
  assert.equal(pickMembership(rows, 'u1').farmId, 'older');
  // Same answer whatever order the server returns them in.
  assert.equal(pickMembership([...rows].reverse(), 'u1').farmId, 'older');
});

check('the count is reported rather than hidden', () => {
  const rows = [
    row('u1', 'owner', { farm_id: 'a', created_at: '2026-01-01T00:00:00Z' }),
    row('u1', 'driver', { farm_id: 'b', created_at: '2026-02-01T00:00:00Z' }),
    row('u2', 'owner', { farm_id: 'a' }),
  ];
  assert.equal(pickMembership(rows, 'u1').memberships, 2);
  assert.equal(pickMembership(rows, 'u2').memberships, 1);
});

console.log('\n=== the shape the app expects ===');

check('every field the app reads is present', () => {
  const m = pickMembership([row('u1', 'manager', { can_write_production: true })], 'u1');
  assert.equal(m.farmId, FARM);
  assert.equal(m.role, 'manager');
  assert.equal(m.canWriteProduction, true);
  assert.equal(m.farmName, 'Sunnyridge');
});

check('a farm with no name given yet reads as empty, not undefined', () => {
  const m = pickMembership([row('u1', 'owner', { farms: null })], 'u1');
  assert.equal(m.farmName, '');
});

check('canWriteProduction is a boolean whatever the column says', () => {
  for (const v of [null, undefined, 0, 'false']) {
    const m = pickMembership([row('u1', 'driver', { can_write_production: v })], 'u1');
    assert.equal(typeof m.canWriteProduction, 'boolean', String(v));
  }
  assert.equal(pickMembership([row('u1', 'driver', { can_write_production: true })], 'u1')
    .canWriteProduction, true);
});

console.log('\n=== the query is filtered at the server too ===');

check('getMembership asks only for this user\'s rows', () => {
  // Belt as well as braces: the module above is the second line of defence,
  // and it should never be the only one. If this assertion fails, the filter
  // has been dropped from the query and every device is fetching the whole
  // farm's membership list to throw most of it away.
  const auth = readFileSync(new URL('../docs/js/auth.js', import.meta.url), 'utf8');
  assert.ok(auth.includes(".eq('user_id'"), 'auth.js no longer filters by user_id');
  assert.ok(auth.includes('pickMembership'), 'auth.js no longer uses pickMembership');
});

console.log('');
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('ALL PASS');
