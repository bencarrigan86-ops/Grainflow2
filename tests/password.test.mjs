// Run with:
//   node tests/password.test.mjs
//
// Forgetting a password and changing one: the reset link's trail through the app, the checks on a new password, the screens, and a
// phone that is still signed in as an account that has been deleted.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isRecoveryHash, isExpiredLinkHash, noteRecoveryLink, isRecovering, endRecovery, takeResetExpired, checkNewPassword, resetRedirect,
  accountGone, RESET_SENT, RESET_EXPIRED,
} from '../docs/js/recovery.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

check('a reset link is told from an ordinary address, and a dead one from both', () => {
  assert.ok(isRecoveryHash('#access_token=abc&expires_in=3600&refresh_token=x&token_type=bearer&type=recovery'));
  assert.ok(isRecoveryHash('#type=recovery'));
  assert.ok(!isRecoveryHash('#/join/AbCdEfGhIjKlMnOpQrSt'));
  assert.ok(!isRecoveryHash('#access_token=abc&type=signup'));
  assert.ok(!isRecoveryHash(''));
  const dead = '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
  assert.ok(isExpiredLinkHash(dead));
  assert.ok(!isExpiredLinkHash('#/settings'));
});

check('what the link said is kept for the tab until the new password is chosen', () => {
  const s = memory();
  assert.equal(isRecovering(s), false);
  noteRecoveryLink('#/position', s);
  assert.equal(isRecovering(s), false, 'an ordinary address says nothing');
  noteRecoveryLink('#access_token=a&type=recovery', s);
  assert.equal(isRecovering(s), true);
  assert.equal(isRecovering(s), true, 'still so after a reload');
  endRecovery(s);
  assert.equal(isRecovering(s), false);
});

check('a dead link is remembered once, so the sign-in screen can say so, and only once', () => {
  const s = memory();
  noteRecoveryLink('#error=access_denied&error_code=otp_expired', s);
  assert.equal(takeResetExpired(s), true);
  assert.equal(takeResetExpired(s), false);
  assert.equal(isRecovering(s), false);
  assert.ok(RESET_EXPIRED.includes('Ask for a new one'));
});

check('storage that refuses is not a crash', () => {
  const broken = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } };
  noteRecoveryLink('#type=recovery', broken);
  assert.equal(isRecovering(broken), false);
  endRecovery(broken);
  assert.equal(takeResetExpired(broken), false);
});

check('a new password is long enough and typed twice the same', () => {
  assert.equal(checkNewPassword('', ''), 'Type the new password.');
  assert.match(checkNewPassword('abc', 'abc'), /at least 6/);
  assert.match(checkNewPassword('abcdef', 'abcdeg'), /not the same/);
  assert.equal(checkNewPassword('abcdef', 'abcdef'), '');
});

check('the link comes back to the app\'s front door, with nothing after it', () => {
  assert.equal(resetRedirect({ origin: 'https://grainflow2.bencarrigan86.workers.dev', pathname: '/' }), 'https://grainflow2.bencarrigan86.workers.dev/');
  assert.equal(resetRedirect(null), '');
  assert.ok(!RESET_SENT.toLowerCase().includes('no account'), 'the same answer whether or not the address has an account');
});

check('an account that is gone is told from a server that cannot be reached', () => {
  assert.ok(accountGone({ message: 'User from sub claim in JWT does not exist', status: 403 }));
  assert.ok(accountGone({ message: 'User not found', status: 404 }));
  assert.ok(accountGone({ message: 'x', status: 403 }));
  assert.ok(!accountGone({ message: 'Failed to fetch', status: 0 }));
  assert.ok(!accountGone({ message: 'AuthRetryableFetchError: fetch failed', status: 502 }));
  assert.ok(!accountGone(null));
});

check('the sign-in screen has Forgot password, a reset screen, and the farm screen has a way out', () => {
  const lg = read('docs/js/views/login.js');
  assert.ok(lg.includes('id="to-forgot"') && lg.includes('Forgot password?') && lg.includes('id="send-reset"'));
  assert.ok(lg.includes("requestPasswordReset(email)") && lg.includes('RESET_SENT'));
  assert.ok(lg.includes("draw(mode, notice?.text, notice?.kind)"), 'a dead link is said on the sign-in screen');
  assert.ok(lg.includes('id="farm-signout"') && lg.includes('Not you? Sign out'));
});

check('the auth calls: reset email, new password, change password checks the old one without signing in again', () => {
  const au = read('docs/js/auth.js');
  assert.ok(au.includes('resetPasswordForEmail(') && au.includes('redirectTo: resetRedirect()'));
  assert.ok(au.includes('updateUser({ password })'));
  const ch = au.slice(au.indexOf('export async function changePassword'), au.indexOf('/**\n * Is the account this phone'));
  assert.ok(ch.includes('isolatedClient().auth.signInWithPassword') && !ch.includes('supabase.auth.signInWithPassword'), 'the old password is checked on a client of its own');
  assert.ok(read('docs/js/supabase.js').includes('persistSession: false') && read('docs/js/supabase.js').includes('noteRecoveryLink(globalThis.location?.hash)'));
  assert.ok(au.includes('farm_users_user_id_fkey') && au.includes('export async function sessionStillValid'));
});

check('the app opens the new-password screen for a reset link, ahead of everything else, and carries on after', () => {
  const mn = read('docs/js/main.js');
  assert.ok(mn.includes('if (isRecovering()) {') && mn.includes('renderNewPassword(app'));
  assert.ok(mn.indexOf('if (isRecovering()) {') < mn.indexOf('clearTrialEmail();\n'), 'before the farm is opened');
  assert.ok(mn.includes("event === 'PASSWORD_RECOVERY'") && mn.includes('endRecovery();'));
  assert.ok(mn.includes('if (!(await sessionStillValid())) return;'));
  const np = read('docs/js/views/newpassword.js');
  assert.ok(np.includes('checkNewPassword(') && np.includes('setNewPassword(') && np.includes('id="np-skip"'));
});

check('Change password is on the Account screen, asks for the current one, and the new one twice', () => {
  assert.ok(read('docs/js/views/account.js').includes('id="change-password"') && read('docs/js/views/account.js').includes('openChangePasswordSheet()'));
  const cp = read('docs/js/views/changepassword.js');
  assert.ok(cp.includes('cp-current') && cp.includes('cp-new') && cp.includes('cp-again') && cp.includes('changePassword(current'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
