// Run with:
//   node tests/trials.test.mjs
//
// Trial farms: the support login invites somebody by email; when they create their farm it is theirs alone and the support login is
// added read only with no end date; the owner is told, and can switch it off. The database does the access, so most of this is
// checking that the pieces are there and wired, and the wording.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSION } from '../docs/js/version.js';
const stamp = APP_VERSION.split('.').pop();
const { validEmail, trialInviteMessage, farmLabel, standingText, trialNoticeText, trialSampleText, ownSeasonGuess, startOwnWarning, startedLine, trialLink, emailFromTrialHash } = await import(`../docs/js/trialtext.js?v=${stamp}`);
const { standingStatus } = await import('../docs/js/supportinfo.js');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

check('an email is checked for the obvious slips', () => {
  assert.equal(validEmail('sam@farm.com.au'), true);
  assert.equal(validEmail('  sam@farm.com.au '), true);
  assert.equal(validEmail('sam@farm'), false);
  assert.equal(validEmail('sam farm@x.com'), false);
  assert.equal(validEmail(''), false);
  assert.equal(validEmail(null), false);
});

check('the message says where to go, which address to use, to keep the sample, and who can see the farm', () => {
  const m = trialInviteMessage(' Sam@Farm.com.au ', 'https://example.test');
  assert.ok(m.includes('https://example.test'));
  assert.ok(m.includes('sam@farm.com.au'), 'the address they must sign up with, lower case');
  assert.ok(/sample farm/.test(m));
  assert.ok(/nobody else I invite can see it/i.test(m));
  assert.ok(/read only/i.test(m) && /switch that off/i.test(m));
});

check('a farm is listed by name, with the owner when it is somebody else\'s', () => {
  assert.equal(farmLabel({ farm_name: 'Smith Farming', role: 'support', owner_email: 'sam@farm.com.au' }), 'Smith Farming (sam@farm.com.au)');
  assert.equal(farmLabel({ farm_name: 'Home', role: 'owner', owner_email: null }), 'Home');
  assert.equal(farmLabel({ role: 'owner' }), 'Unnamed farm');
});

check('the owner is told in words, before and after: read only, can be switched off', () => {
  assert.ok(/read only/.test(standingText()) && /switch it off/.test(standingText()));
  assert.ok(/yours alone/.test(trialNoticeText()) && /read only/.test(trialNoticeText()) && /switch that off/.test(trialNoticeText()));
  assert.deepEqual(standingStatus('x'), { on: true, text: 'x' }, 'the card shows the take-away button while it is on');
});

check('a trial is always the sample farm: the empty choice is taken away from somebody who was invited', () => {
  assert.ok(/sample farm/.test(trialSampleText()) && /Sample 2026/.test(trialSampleText()));
  const lg = read('docs/js/views/login.js');
  assert.ok(lg.includes('trialSampleText()') && lg.includes("seed.value = 'sample'"));
  assert.ok(lg.includes("root.querySelector('#farm-seed')?.value !== 'empty'"), 'the sign-up still reads the choice the same way, so the sample is what is loaded');
});

check('the SQL: invitations are reachable only through the support login, and the farm is made theirs alone', () => {
  const sql = read('supabase/migrations/20261118700000_trial_invites.sql');
  assert.ok(sql.includes('create table if not exists trial_invites') && sql.includes('enable row level security'));
  assert.ok(!/create policy[^;]*trial_invites/i.test(sql) && !/grant\s+(select|insert|update|delete)[^;]*trial_invites/i.test(sql), 'no direct access to the table');
  for (const fn of ['trial_invite_create', 'trial_invite_withdraw', 'trial_invites_list', 'support_farms']) {
    const body = sql.slice(sql.indexOf(`function ${fn}(`));
    assert.ok(body.slice(0, 900).includes('is_support_admin()'), `${fn} is for the support login only`);
  }
  assert.ok(sql.includes('function create_farm(') && sql.includes("'support', false, null"), 'read only, no end date');
  assert.ok(sql.includes('v_support <> auth.uid()'), 'the support login inviting itself is not a trial');
  assert.ok(sql.includes('used_at = now(), farm_id = p_farm_id'), 'an invitation is used once');
  assert.ok(sql.includes('trial_invites_open_email'), 'one open invitation per address');
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('function trial_invite_create('));
});

check('it is wired: Settings has the support login\'s card, owners see the notice, new trial owners are told, the banner can switch farm', () => {
  const se = read('docs/js/views/settings.js');
  assert.ok(se.includes('trialFarmsSlotHtml()') && se.includes('wireTrialFarms(root)'));
  const tf = read('docs/js/views/trialfarms.js');
  assert.ok(tf.includes('setPreferredFarm(farmId)') && tf.includes('location.reload()'));
  assert.ok(tf.includes('getSyncStatus') && tf.includes('pending > 0'), 'never leave unsent changes behind on a switch');
  assert.ok(read('docs/js/auth.js').includes('export function setPreferredFarm'));
  assert.ok(read('docs/js/views/support.js').includes('trialWatched(farmId)'));
  assert.ok(read('docs/js/views/login.js').includes('hasTrialInvite()'));
  const main = read('docs/js/main.js');
  assert.ok(main.includes("noteSupportOpen(membership.farmId, membership.farmName)") && main.includes('Switch farm'));
});

check('starting their own farm: the words, the flag line, and what is wired', () => {
  assert.equal(ownSeasonGuess(new Date('2026-11-16T00:00:00')), '2026');
  assert.ok(/clears the sample/i.test(startOwnWarning()) && /cannot be brought back/.test(startOwnWarning()));
  assert.equal(startedLine({}), '');
  assert.ok(/^started their own farm 1[56] Nov$/.test(startedLine({ started_at: '2026-11-16T03:00:00Z' })), startedLine({ started_at: '2026-11-16T03:00:00Z' }));
  const tf = read('docs/js/views/trialfarms.js');
  assert.ok(tf.includes('recordStartOwn(') && tf.includes('db.startOwnFarm({ season })'));
  assert.ok(tf.indexOf('recordStartOwn(') < tf.indexOf('db.startOwnFarm({ season })'), 'the server is told first, so a failure clears nothing');
  assert.ok(tf.includes('navigator.onLine'), 'needs a connection');
  const se = read('docs/js/views/settings.js');
  assert.ok(se.includes("db.getRole() === 'owner' ? trialOwnSlotHtml()") && se.includes('wireTrialOwner(root)'));
  assert.ok(read('docs/js/storage.js').includes('startOwnFarm({ season } = {})'));
  const sql = read('supabase/migrations/20261118800000_trial_start_own.sql');
  assert.ok(sql.includes('function trial_start_own(') && sql.includes("app_role(p_farm_id) is distinct from 'owner'") && sql.includes('this is not a trial farm'));
  assert.ok(sql.includes('started_at = coalesce(started_at, now())'), 'recorded once');
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('function trial_start_own('));
});

check('the trial link opens sign-up with their email in it, and the email comes back out of it', () => {
  const link = trialLink(' Sam@Farm.com.au ', 'https://example.test/app');
  assert.equal(link, 'https://example.test/app/#/try/sam%40farm.com.au');
  assert.equal(emailFromTrialHash('#/try/sam%40farm.com.au'), 'sam@farm.com.au');
  assert.equal(emailFromTrialHash(new URL(link).hash), 'sam@farm.com.au');
  assert.equal(emailFromTrialHash('#/try/not-an-email'), null);
  assert.equal(emailFromTrialHash('#/try/%E0%A4%A'), null, 'a broken escape is no email');
  assert.equal(emailFromTrialHash('#/join/abcdefghijklmnopqrstuv'), null, 'an invitation link is not a trial link');
  assert.equal(emailFromTrialHash(''), null);
  assert.ok(trialInviteMessage('sam@farm.com.au', 'https://example.test/').includes('https://example.test/#/try/sam%40farm.com.au'), 'the message carries the link');
  const main = read('docs/js/main.js');
  assert.ok(main.includes('stashTrialFromHash();') && main.includes('trialEmail: readTrialEmail()') && main.includes('clearTrialEmail();'));
  const lg = read('docs/js/views/login.js');
  assert.ok(lg.includes('trialEmail && !invited && mode ===') && lg.includes('emailEl.value = trialEmail'));
  const tf = read('docs/js/views/trialfarms.js');
  assert.ok(tf.includes('Copy link only') && tf.includes('Nothing has been sent to them yet'), 'honest that the app does not send it');
});

check('the paste file can be run whole, again and again: a function whose shape changed is dropped before it is made', () => {
  const sql = read('supabase/paste-into-sql-editor.sql');
  for (const fn of ['trial_invites_list', 'support_farms']) {
    const makes = [...sql.matchAll(new RegExp(`create (or replace )?function ${fn}\\(`, 'g'))];
    assert.ok(makes.length >= 2, `${fn} is made more than once`);
    for (const mk of makes) {
      assert.ok(!mk[1], `${fn}: a plain create, never create or replace`);
      assert.ok(new RegExp(`drop function if exists ${fn}\\(\\);\\s*$`).test(sql.slice(0, mk.index)), `${fn} is dropped just before it is made`);
    }
  }
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
