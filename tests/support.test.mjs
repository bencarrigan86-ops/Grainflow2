// Run with:
//   node tests/support.test.mjs
//
// Support tools: the read-only support access the owner can give, "Report a problem", and the test copy.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addError, errorEntry, buildReport, reportText, supportStatusText, logLine, whenText, MAX_ERRORS, accessNote, SUPPORT_TICK, SUPPORT_TICK_HINT } from '../docs/js/supportinfo.js';
import { environmentFor, isTestHost, LIVE } from '../docs/js/env.js';
import { tabsForRole, canOpen } from '../docs/js/nav.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const sql = read('supabase/migrations/20261117200000_support_access.sql');

console.log('\n=== the database ===');
check('support access expires by itself: every policy asks app_role, and app_role ignores a past expiry', () => {
  assert.match(sql, /create or replace function app_role[\s\S]*?and \(expires_at is null or expires_at > now\(\)\)/);
  assert.match(sql, /add column if not exists expires_at timestamptz/);
});
check('only the owner grants or takes it away, for at most 14 days, defaulting to 7', () => {
  assert.match(sql, /grant_support_access[\s\S]*?app_role\(p_farm_id\) is distinct from 'owner'/);
  assert.match(sql, /revoke_support_access[\s\S]*?app_role\(p_farm_id\) is distinct from 'owner'/);
  assert.match(sql, /p_days int default 7/);
  assert.match(sql, /least\(coalesce\(p_days, 7\), 14\)/);
});
check('support gets a read policy on each table and never a write one; the bank table is not on the list', () => {
  assert.match(sql, /for select using \(app_role\(farm_id\) = ''support''/);
  assert.ok(!/create policy support_\w+ on \w+ for (insert|update)/.test(sql));
  const list = sql.slice(sql.indexOf('foreach t in array array['), sql.indexOf('] loop'));
  assert.ok(!list.includes('farm_bank') && !list.includes('farm_users'));
  assert.ok(list.includes("'sales'") && list.includes("'input_stock'"));
});
check('grants, revokes and every time support opens the farm are logged, and only the owner reads the log', () => {
  for (const a of ['granted', 'revoked', 'opened']) assert.ok(sql.includes(`'${a}'`), a);
  assert.match(sql, /support_access_log_select on support_access_log for select\s+using \(app_role\(farm_id\) = 'owner'\)/);
  assert.match(sql, /log_support_open/);
});
check('no client can read or write who support is', () => {
  assert.match(sql, /alter table support_settings enable row level security/);
  assert.ok(!/create policy \w+ on support_settings/.test(sql));
  assert.ok(!/grant [a-z, ]+ on support_settings/.test(sql));
});
check('a report can be inserted by the person it is from, on a farm they belong to', () => {
  assert.match(sql, /problem_reports_insert on problem_reports for insert\s+with check \(user_id = auth.uid\(\) and \(farm_id is null or app_is_member\(farm_id\)\)\)/);
});
check('it is all in the paste file', () => {
  const paste = read('supabase/paste-into-sql-editor.sql');
  assert.ok(paste.includes('create or replace function grant_support_access') && paste.includes('create table if not exists problem_reports'));
});

console.log('\n=== the app ===');
check('support sees the whole bar but nothing it does is queued to send', () => {
  assert.deepEqual(tabsForRole('support'), tabsForRole('owner'));
  assert.ok(canOpen('support', 'settings'));
  assert.match(read('docs/js/storage.js'), /if \(role === 'support' \|\| role === 'advisor'\) \{ \/\* read only \*\/ \}/);
});
check('support does not see the bank section, and the owner is the one who can give access', () => {
  const s = read('docs/js/views/settings.js');
  assert.ok(s.includes("db.getRole() === 'owner' ? supportCardHtml() : ''"));
  assert.ok(s.includes("const seesBank = ['owner', 'bookkeeper'].includes(db.getRole());"));
});
check('Report a problem is on Account (every role) and Settings', () => {
  assert.match(read('docs/js/views/account.js'), /id="report-problem"/);
  assert.match(read('docs/js/views/settings.js'), /id="report-problem"/);
  assert.match(read('docs/js/main.js'), /installErrorLog\(\)/);
  assert.match(read('docs/js/main.js'), /log_support_open/);
});

console.log('\n=== reports ===');
check('only the last errors are kept, newest last, and long messages are cut', () => {
  let list = [];
  for (let i = 0; i < MAX_ERRORS + 5; i += 1) list = addError(list, errorEntry('error', `boom ${i}`, `2026-11-16T00:00:${String(i).padStart(2, '0')}Z`));
  assert.equal(list.length, MAX_ERRORS);
  assert.equal(list.at(-1).message, `boom ${MAX_ERRORS + 4}`);
  assert.ok(errorEntry('error', 'x'.repeat(2000)).message.length <= 300);
});
check('a report carries the build, role, sync state and errors, and nothing of the farm', () => {
  const r = buildReport({
    message: ' The load would not save ', build: '2026-11-16.277', role: 'manager', online: false,
    sync: { pending: 3, lastError: { table: 'movements', code: '42501', message: 'new row violates row-level security policy', sample: { secret: 1 } } },
    errors: [errorEntry('error', 'TypeError: x is undefined', '2026-11-16T01:02:03Z')], screen: '#/movement',
  });
  assert.equal(r.message, 'The load would not save');
  assert.equal(r.details.waitingToSend, 3);
  assert.equal(r.details.online, false);
  assert.match(r.details.lastSendError, /movements: 42501: new row violates/);
  assert.ok(!JSON.stringify(r).includes('secret'));
  const t = reportText(r);
  assert.match(t, /Build: 2026-11-16.277/);
  assert.match(t, /Waiting to send: 3/);
  assert.match(t, /TypeError: x is undefined/);
});
check('Report a problem can give support access with the report: an owner ticks, it is noted on the report, and others are told who can', () => {
  const v = read('docs/js/views/support.js');
  assert.ok(v.includes('id="rp-access-tick"') && v.includes("role === 'owner'"), 'only an owner is offered the tick');
  assert.ok(v.includes("supabase.rpc('grant_support_access', { p_farm_id: db.getFarmId(), p_days: 7 })"), 'the same grant as Settings, for 7 days');
  assert.ok(v.indexOf("supabase.rpc('grant_support_access', { p_farm_id: db.getFarmId(), p_days: 7 })", v.indexOf('rp-send')) < v.indexOf("from('problem_reports').insert"), 'the grant is tried first, so the report says what happened');
  assert.ok(v.includes('SUPPORT_ALREADY') && v.includes('SUPPORT_OWNER_ONLY'));
  assert.equal(accessNote('given'), 'Support access: given for 7 days with this report.');
  assert.match(accessNote('failed'), /did not go through/);
  assert.equal(accessNote(''), '');
  assert.match(SUPPORT_TICK, /read only, for 7 days/);
  assert.match(SUPPORT_TICK_HINT, /cannot change anything or see your bank details/);
});
check('an empty report says so rather than printing blanks', () => {
  const t = reportText(buildReport({ build: 'b', role: 'owner' }));
  assert.match(t, /Last send error: none/);
  assert.match(t, /Recent errors: none/);
});
check('support access is described in words, on or off', () => {
  const now = new Date('2026-11-16T00:00:00Z');
  assert.equal(supportStatusText(null, now).on, false);
  assert.equal(supportStatusText('2026-11-10T00:00:00Z', now).on, false);
  const on = supportStatusText('2026-11-23T05:15:00Z', now);
  assert.equal(on.on, true);
  assert.match(on.text, /read only, until \d+ Nov 2026/);
  assert.match(logLine({ action: 'granted', at: '2026-11-16T01:00:00Z' }), /^Access given · \d+ Nov 2026/);
  assert.equal(whenText('nonsense'), '');
});

console.log('\n=== the test copy ===');
check('the live address and localhost use the live database', () => {
  assert.equal(environmentFor('grainflow2.bencarrigan86.workers.dev').url, LIVE.url);
  assert.equal(environmentFor('localhost').name, 'live');
  assert.equal(isTestHost('grainflow2-test.example.workers.dev'), true);
  assert.equal(isTestHost('grainflow2.example.workers.dev'), false);
});
check('a test copy that is not set up talks to nothing, never to the live database', () => {
  const e = environmentFor('grainflow2-test.x.workers.dev', { name: 'test', url: '', key: '' });
  assert.equal(e.configured, false);
  assert.notEqual(e.url, LIVE.url);
  assert.ok(e.url.endsWith('.invalid'));
});
check('once set up it uses the test project', () => {
  const e = environmentFor('grainflow2-test.x.workers.dev', { name: 'test', url: 'https://t.supabase.co', key: 'k' });
  assert.deepEqual([e.url, e.key, e.configured], ['https://t.supabase.co', 'k', true]);
});

console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
process.exit(failures ? 1 : 0);
