#!/usr/bin/env node
//
// The tab bar against the database's own policies.
//
//   node tests/nav.test.mjs
//
// The interesting half of this file is not the assertions about the lists — it
// is the section that reads supabase/migrations, works out which roles each
// SELECT policy admits, and fails if any role is offered a tab whose data the
// server will not send it. That is the check that cannot be satisfied by me
// agreeing with myself.

import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROLES, TABS_BY_ROLE, OFF_BAR_BY_ROLE, TAB_NEEDS,
  tabsForRole, routesForRole, landingTabFor, canOpen, gearTargetFor,
} from '../docs/js/nav.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); }
  catch (e) { failures += 1; console.log(`  FAIL  ${name}\n         ${e.message}`); }
};

// ---------------------------------------------------------------------------
// What the database will actually send each role
// ---------------------------------------------------------------------------

/** table -> the roles its SELECT policy admits, or null for "any member". */
function readPolicies() {
  const dir = join(ROOT, 'supabase', 'migrations');
  const out = new Map();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, f), 'utf8');
    for (const m of sql.matchAll(/create policy \w+_select on (\w+) for select\s*([\s\S]*?);/g)) {
      const [, table, body] = m;
      const named = [...new Set([...body.matchAll(/'(owner|manager|bookkeeper|farm_worker|driver)'/g)]
        .map((x) => x[1]))];
      out.set(table, named.length ? named : null);   // null = every member
    }
  }
  return out;
}

const policies = readPolicies();

console.log('\n=== every tab offered is a tab the server will fill ===');

check('the policies were actually parsed', () => {
  assert.ok(policies.size > 8, `only found ${policies.size} select policies — the parse has gone stale`);
  assert.ok(policies.has('field_agronomy'), 'field_agronomy policy not found');
});

check('no role is given a tab it cannot read the data for', () => {
  const problems = [];
  for (const role of ROLES) {
    for (const tab of routesForRole(role)) {
      const table = TAB_NEEDS[tab];
      if (!table) continue;                       // account has no table of its own
      const allowed = policies.get(table);
      if (allowed === undefined) { problems.push(`${tab}: no policy found for ${table}`); continue; }
      if (allowed === null) continue;             // readable by every member
      if (!allowed.includes(role)) {
        problems.push(`${role} is offered "${tab}" but cannot read ${table}`);
      }
    }
  }
  assert.deepEqual(problems, [], `\n         ${problems.join('\n         ')}`);
});

check('the check would catch a driver being given Production', () => {
  // Guarding the guard: if this ever passes, the check above proves nothing.
  const allowed = policies.get(TAB_NEEDS.production);
  assert.ok(Array.isArray(allowed), 'field_agronomy should be role-restricted');
  assert.ok(!allowed.includes('driver'), 'a driver must not be able to read agronomy');
});

// ---------------------------------------------------------------------------
// The bars themselves
// ---------------------------------------------------------------------------

console.log('\n=== what each role gets ===');

check('a driver gets movements and nothing else', () => {
  assert.deepEqual(tabsForRole('driver'), ['movement']);
});

check('a driver can still reach Account, or they cannot sign out', () => {
  assert.equal(canOpen('driver', 'account'), true);
});

check('and there is a way to get there from the screen', () => {
  // Being allowed to open a route is not the same as having a route to it.
  // Account lives behind the Settings screen, so hiding the gear from a driver
  // hid the only door — they could see one tab and had no way to sign out.
  for (const role of ROLES) {
    const target = gearTargetFor(role);
    assert.ok(canOpen(role, target), `${role}'s gear goes to ${target}, which it cannot open`);
  }
  assert.equal(gearTargetFor('driver'), 'account');
  assert.equal(gearTargetFor('farm_worker'), 'account');
  assert.equal(gearTargetFor('owner'), 'settings');
});

check('every role has a reachable way to sign out', () => {
  // Account is where signOut lives. Reachable means: in the tab bar, or where
  // the gear goes. Anything else is a route only a developer knows about.
  for (const role of ROLES) {
    const reachable = new Set([...tabsForRole(role), gearTargetFor(role)]);
    assert.ok(reachable.has('account') || reachable.has('settings'),
      `${role} has no way to reach the sign-out button`);
  }
});

check('a worker gets no Sales tab', () => {
  assert.ok(!tabsForRole('farm_worker').includes('sales'));
  assert.equal(canOpen('farm_worker', 'sales'), false);
});

check('a worker keeps Production, Movement, Storage and Reports', () => {
  assert.deepEqual(tabsForRole('farm_worker'),
    ['production', 'movement', 'storage', 'reports']);
});

check('a worker gets no Position tab — that screen is the book', () => {
  assert.ok(!tabsForRole('farm_worker').includes('position'));
  assert.equal(canOpen('farm_worker', 'position'), false);
});

check('Settings stops at manager', () => {
  for (const r of ['owner', 'manager', 'bookkeeper']) assert.equal(canOpen(r, 'settings'), true, r);
  for (const r of ['farm_worker', 'driver']) assert.equal(canOpen(r, 'settings'), false, r);
});

check('an owner gets every tab', () => {
  assert.equal(tabsForRole('owner').length, 6);
});

console.log('\n=== where each role lands ===');

check('everyone lands somewhere they can actually use', () => {
  for (const role of ROLES) {
    const landing = landingTabFor(role);
    assert.ok(tabsForRole(role).includes(landing), `${role} lands on ${landing}, not in its own bar`);
  }
});

check('a driver lands on Movement, not an empty Position screen', () => {
  assert.equal(landingTabFor('driver'), 'movement');
});

console.log('\n=== the address bar is guarded too ===');

check('typing a route you have no business on is refused', () => {
  assert.equal(canOpen('driver', 'production'), false);
  assert.equal(canOpen('driver', 'reports'), false);
  assert.equal(canOpen('farm_worker', 'settings'), false);
});

check('an unknown or missing role gets the narrowest bar, not the widest', () => {
  // A membership row that arrives with a role this build does not know about
  // must fail closed. Failing open would hand a stranger the whole book.
  for (const bogus of ['admin', '', null, undefined, 'OWNER']) {
    assert.deepEqual(tabsForRole(bogus), ['movement'], `role ${JSON.stringify(bogus)}`);
    assert.equal(canOpen(bogus, 'sales'), false);
    assert.equal(canOpen(bogus, 'settings'), false);
  }
});

check('every role has a bar and an off-bar list', () => {
  for (const role of ROLES) {
    assert.ok(TABS_BY_ROLE[role]?.length, `${role} has no tabs`);
    assert.ok(OFF_BAR_BY_ROLE[role]?.includes('account'), `${role} cannot reach Account`);
  }
});

check('no tab appears twice in a bar', () => {
  for (const role of ROLES) {
    const t = tabsForRole(role);
    assert.equal(new Set(t).size, t.length, `${role} has a duplicate tab`);
  }
});

check('the returned lists cannot be mutated by a caller', () => {
  const t = tabsForRole('owner');
  t.push('everything');
  assert.equal(tabsForRole('owner').length, 6, 'tabsForRole handed out its own array');
});

console.log('\n=== the bar matches the views that exist ===');

check('every tab id has a view wired to it in main.js', () => {
  const main = readFileSync(join(ROOT, 'docs', 'js', 'main.js'), 'utf8');
  const ids = new Set(Object.keys(TAB_NEEDS).concat('account'));
  for (const id of ids) {
    assert.ok(main.includes(`id: '${id}'`), `main.js has no route for "${id}"`);
  }
});

console.log('');
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('ALL PASS');
