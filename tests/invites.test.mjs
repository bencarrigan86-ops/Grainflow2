#!/usr/bin/env node
//
// Inviting someone onto a farm.
//
//   node tests/invites.test.mjs
//
// The server-side half of this — accept_invitation() — is tested against a real
// Postgres, because that is where the actual security lives: the token, the
// expiry and the email match are all checked there, and a client that got any
// of it wrong would simply be refused. This file covers the part that decides
// what gets written in the first place, and the link that carries it.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  INVITABLE_ROLES, DEFAULT_EXPIRY_DAYS,
  newToken, inviteLink, tokenFromHash, validateInvite, roleLabel, canEditMember,
  expiryFrom, expiryText,
} from '../docs/js/invites.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); }
  catch (e) { failures += 1; console.log(`  FAIL  ${name}\n         ${e.message}`); }
};

console.log('\n=== the token ===');

check('is long, random and hex', () => {
  const t = newToken();
  assert.match(t, /^[0-9a-f]{64}$/, `got ${t}`);
});

check('never repeats', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i += 1) seen.add(newToken());
  assert.equal(seen.size, 2000);
});

check('carries nothing about who it is for', () => {
  // A token derived from the email or the farm is one somebody else can build.
  const t = newToken();
  for (const leak of ['driver', 'sunnyridge', '@', '2026']) {
    assert.ok(!t.includes(leak), `token contains "${leak}"`);
  }
});

console.log('\n=== the link ===');

check('is the app, with the token on the end', () => {
  assert.equal(
    inviteLink('abc123def456abc123', 'https://grainflow2.example.dev', '/'),
    'https://grainflow2.example.dev/#/join/abc123def456abc123');
});

check('does not double the slash on a path that already ends in one', () => {
  assert.equal(inviteLink('abc123def456abc123', 'https://x.dev', '/app/'),
    'https://x.dev/app/#/join/abc123def456abc123');
});

check('round trips: a link made here is read back by the app', () => {
  const t = newToken();
  const link = inviteLink(t, 'https://x.dev', '/');
  assert.equal(tokenFromHash(new URL(link).hash), t);
});

check('an ordinary hash is not mistaken for an invitation', () => {
  for (const h of ['', '#/position', '#/settings', '#/join', '#/join/', '#/join/short']) {
    assert.equal(tokenFromHash(h), null, `"${h}" was read as a token`);
  }
});

check('junk does not throw', () => {
  assert.equal(tokenFromHash(null), null);
  assert.equal(tokenFromHash(undefined), null);
  assert.equal(tokenFromHash(42), null);
});

console.log('\n=== what an owner may hand out ===');

check('owner is one of the choices — a family farm has several', () => {
  // This assertion is the reverse of the one it replaces. The first version
  // withheld owner on the grounds that a second one is a serious decision;
  // a partnership has several owners by definition, and the database never
  // restricted it, so the interface should not either.
  assert.ok(INVITABLE_ROLES.some((r) => r.value === 'owner'),
    'a farm with more than one owner must be invitable, not a SQL statement');
});

check('the owner blurb says what it costs', () => {
  // The safeguard is now informed consent rather than a missing option, so the
  // wording is load-bearing: it has to name the two things that actually matter
  // before somebody picks it off a dropdown next to "driver".
  const owner = INVITABLE_ROLES.find((r) => r.value === 'owner');
  assert.match(owner.blurb, /bank/i, 'the blurb does not mention the bank details');
  assert.match(owner.blurb, /removing|remove/i, 'the blurb does not say they can remove people');
});

check('every offered role is one the app knows', () => {
  const known = ['owner', 'manager', 'bookkeeper', 'farm_worker', 'driver'];
  assert.deepEqual(INVITABLE_ROLES.map((r) => r.value).sort(), [...known].sort());
});

check('the roles offered match the roles the database will accept', () => {
  // Read out of the schema rather than restated here — an invitation carrying a
  // role the check constraint rejects fails at the insert, after the owner has
  // typed an address and picked from a list that looked fine.
  const sql = readFileSync(
    new URL('../supabase/migrations/20260831120000_initial_schema.sql', import.meta.url), 'utf8');
  const block = sql.slice(sql.indexOf('create table invitations'));
  const allowed = block.match(/check \(role in \(([^)]*)\)\)/)[1]
    .split(',').map((s) => s.trim().replace(/'/g, '')).sort();
  assert.deepEqual(INVITABLE_ROLES.map((r) => r.value).sort(), allowed);
});

check('every role has a label and a plain-English blurb', () => {
  for (const r of INVITABLE_ROLES) {
    assert.ok(r.label && r.label.length > 2, `${r.value} has no label`);
    assert.ok(r.blurb && r.blurb.length > 20, `${r.value} has no explanation`);
  }
});

console.log('\n=== checking an invitation before it is written ===');

const ok = (over = {}) => validateInvite({ email: 'new@example.com', role: 'driver', ...over });

check('a good one passes, lowercased and trimmed', () => {
  const r = validateInvite({ email: '  New.Person@Example.COM ', role: 'driver' });
  assert.equal(r.ok, true, r.problems.join('; '));
  assert.equal(r.email, 'new.person@example.com');
});

check('a missing address is caught', () => {
  assert.equal(ok({ email: '' }).ok, false);
  assert.equal(ok({ email: '   ' }).ok, false);
});

check('something that is not an address is caught', () => {
  for (const bad of ['ben', 'ben@', '@example.com', 'ben@example', 'ben example.com']) {
    assert.equal(ok({ email: bad }).ok, false, `"${bad}" was accepted`);
  }
});

check('a role that was never chosen is caught', () => {
  assert.equal(ok({ role: '' }).ok, false);
  assert.equal(ok({ role: 'admin' }).ok, false);
  assert.equal(ok({ role: undefined }).ok, false);
});

check('owner passes now, and this assertion used to say the opposite', () => {
  // Left as its own named check rather than folded into the line above, because
  // the line above previously asserted that owner was refused. A rule that
  // reverses is worth a test that says so out loud.
  assert.equal(ok({ role: 'owner' }).ok, true, ok({ role: 'owner' }).problems.join('; '));
});

check('someone already on the farm is caught, and named by their role', () => {
  const r = validateInvite({
    email: 'Ben@example.com', role: 'driver',
    existingMembers: [{ email: 'ben@example.com', role: 'owner' }],
  });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /already on this farm as a Owner|already on this farm as an? Owner/);
});

check('a second invitation to the same person is caught', () => {
  const r = validateInvite({
    email: 'driver@example.com', role: 'driver',
    pendingInvites: [{ email: 'DRIVER@example.com' }],
  });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /already has an invitation waiting/);
});

check('every problem is reported, not just the first', () => {
  const r = validateInvite({ email: 'nonsense', role: 'admin' });
  assert.equal(r.problems.length, 2, r.problems.join('; '));
});

console.log('\n=== who may change whom ===');

const member = (userId, role = 'driver') => ({ userId, email: `${userId}@x.dev`, role });

check('you cannot change yourself — the rule that keeps a farm administrable', () => {
  // With several owners allowed, the only person who could remove the last
  // owner's access is that owner. This is the line that refuses.
  assert.equal(canEditMember(member('u1', 'owner'), 'u1'), false);
  assert.equal(canEditMember(member('u1', 'driver'), 'u1'), false);
});

check('an owner may change another owner', () => {
  // Deliberately allowed. Two people who own a farm together sorting out who
  // does what is a partnership decision, not one for the software to veto.
  assert.equal(canEditMember(member('u2', 'owner'), 'u1'), true);
});

check('everybody else is editable', () => {
  for (const r of ['manager', 'bookkeeper', 'farm_worker', 'driver']) {
    assert.equal(canEditMember(member('u2', r), 'u1'), true, r);
  }
});

check('an unknown viewer or member is refused, not waved through', () => {
  assert.equal(canEditMember(member('u2'), null), false);
  assert.equal(canEditMember(member('u2'), undefined), false);
  assert.equal(canEditMember(member('u2'), ''), false);
  assert.equal(canEditMember(null, 'u1'), false);
  assert.equal(canEditMember({}, 'u1'), false);
  assert.equal(canEditMember(undefined, 'u1'), false);
});

check('at least one member of any farm is always uneditable — whoever is looking', () => {
  // The property that matters, checked as a property rather than a case: for
  // any roster and any viewer on it, exactly the viewer is protected. If that
  // ever stops holding, a farm can be left with nobody who can administer it.
  const roster = [member('a', 'owner'), member('b', 'owner'), member('c', 'manager'),
    member('d', 'driver')];
  for (const viewer of roster) {
    const locked = roster.filter((m) => !canEditMember(m, viewer.userId));
    assert.deepEqual(locked.map((m) => m.userId), [viewer.userId],
      `viewer ${viewer.userId} protected the wrong people`);
  }
});

console.log('\n=== expiry ===');

check('defaults to a fortnight', () => {
  const now = new Date('2026-09-01T00:00:00Z');
  assert.equal(expiryFrom(now).toISOString(), '2026-09-15T00:00:00.000Z');
  assert.equal(DEFAULT_EXPIRY_DAYS, 14);
});

check('reads as a countdown, not a timestamp', () => {
  const now = new Date('2026-09-01T12:00:00Z');
  const at = (d) => new Date(now.getTime() + d).toISOString();
  assert.equal(expiryText(at(5 * 86400000), now), 'expires in 5 days');
  assert.equal(expiryText(at(6 * 3600000), now), 'expires in 6 hours');
  assert.equal(expiryText(at(20 * 60000), now), 'expires within the hour');
  assert.equal(expiryText(at(-1), now), 'expired');
});

check('a missing or unreadable expiry says so rather than lying', () => {
  assert.equal(expiryText(undefined), 'no expiry recorded');
  assert.equal(expiryText('not a date'), 'no expiry recorded');
});

console.log('\n=== role labels ===');

check('every role the database allows has a readable name', () => {
  for (const r of ['owner', 'manager', 'bookkeeper', 'farm_worker', 'driver']) {
    const label = roleLabel(r);
    assert.ok(label && !label.includes('_'), `${r} reads as "${label}"`);
  }
});

console.log('');
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('ALL PASS');
