// Run with:
//   node tests/audit.test.mjs
//
// Audit history: the database writes it (a trigger on each table), the app reads it. These cover the words the screen uses, who can
// open it, and that the SQL keeps it write-protected.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditTitle, changeLines, changeSummary, columnLabel, valueText, whoText, dayHeading, filterAudit, groupByDay, canSeeAudit, AUDIT_KINDS } from '../docs/js/audit.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const sale = { id: 1, at: '2026-11-18T04:14:00Z', user_email: 'sam@farm.com', user_role: 'manager', table_name: 'sales', action: 'changed', label: 'Riverina Grain #RGT-4471', changes: { price: [320, 335], buyer: ['Riverina', 'Riverina Grain'] } };

check('an entry reads as the kind of record, its name and what happened', () => {
  assert.equal(auditTitle(sale), 'Contract Riverina Grain #RGT-4471 changed');
  assert.equal(auditTitle({ table_name: 'movements', action: 'deleted', label: 'Ticket #1058' }), 'Ticket #1058 deleted');
  assert.equal(auditTitle({ table_name: 'payables', action: 'added', label: 'Bimbi Ginning' }), 'Bill Bimbi Ginning added');
  assert.equal(auditTitle({ table_name: 'invoices', action: 'restored', label: 'Invoice #12' }), 'Invoice #12 restored');
});

check('what changed is a line each, in words, with money shown as money', () => {
  const lines = changeLines(sale);
  assert.deepEqual(lines.map((l) => l.label), ['Buyer', 'Price']);
  assert.deepEqual(lines.find((l) => l.label === 'Price'), { label: 'Price', from: '$320', to: '$335' });
  assert.equal(changeSummary(sale), 'Buyer Riverina → Riverina Grain, Price $320 → $335');
  assert.ok(changeSummary({ changes: { a: [1, 2], b: [1, 2], c: [1, 2] } }).endsWith('and 1 more'));
  assert.equal(changeSummary({ action: 'added' }), '');
});

check('a blank, a long value and a yes or no are said plainly', () => {
  assert.equal(valueText('notes', null), 'blank');
  assert.equal(valueText('notes', ''), 'blank');
  assert.equal(valueText('lines', '...'), 'edited');
  assert.equal(valueText('x', { a: 1 }), 'edited');
  assert.equal(valueText('x', true), 'yes');
  assert.equal(valueText('tons', 12.456), '12.46');
  assert.equal(changeSummary({ changes: { lines: ['...', '...'] } }), 'Lines edited');
});

check('a column has a name; one with no word of its own is spaced out', () => {
  assert.equal(columnLabel('payment_terms_days'), 'Payment terms (days)');
  assert.equal(columnLabel('delivery_window_end'), 'Delivery window end');
});

check('who made it: the part of the email before the @ and their role; the server when nobody was signed in', () => {
  assert.equal(whoText(sale), 'sam (manager)');
  assert.equal(whoText({ user_email: 'jo@x.com', user_role: 'farm_worker' }), 'jo (worker)');
  assert.equal(whoText({}), 'The server');
});

check('days read as Today, Yesterday and then the date', () => {
  const now = new Date(2026, 10, 18, 15, 0);
  assert.equal(dayHeading(new Date(2026, 10, 18, 9, 0).toISOString(), now), 'Today');
  assert.equal(dayHeading(new Date(2026, 10, 17, 22, 0).toISOString(), now), 'Yesterday');
  assert.ok(/16-11-2026$/.test(dayHeading(new Date(2026, 10, 16, 12, 0).toISOString(), now)));
});

check('the list filters by kind, newest first, and groups under a heading for each day', () => {
  const rows = [
    { id: 1, at: '2026-11-16T01:00:00Z', table_name: 'sales' },
    { id: 2, at: '2026-11-18T01:00:00Z', table_name: 'movements' },
    { id: 3, at: '2026-11-18T05:00:00Z', table_name: 'invoices' },
    { id: 4, at: '2026-11-17T05:00:00Z', table_name: 'commodities' },
  ];
  assert.deepEqual(filterAudit(rows).map((r) => r.id), [3, 2, 4, 1]);
  assert.deepEqual(filterAudit(rows, 'money').map((r) => r.id), [3]);
  assert.deepEqual(filterAudit(rows, 'loads').map((r) => r.id), [2]);
  assert.deepEqual(filterAudit(rows, 'setup').map((r) => r.id), [4]);
  const now = new Date('2026-11-18T08:00:00Z');
  const days = groupByDay(filterAudit(rows), now);
  assert.equal(days.length, 3);
  assert.equal(days[0].rows.length, 2);
  assert.equal(AUDIT_KINDS.length, 4);
});

check('owners, managers and bookkeepers can open it; nobody else', () => {
  for (const r of ['owner', 'manager', 'bookkeeper']) assert.ok(canSeeAudit(r), r);
  for (const r of ['farm_worker', 'driver', 'support', '', undefined]) assert.ok(!canSeeAudit(r), String(r));
  const settings = read('docs/js/views/settings.js');
  assert.ok(settings.includes('canSeeAudit(db.getRole())') && settings.includes('id="open-audit"') && settings.includes('openAuditSheet()'));
});

check('the SQL: written by a trigger, readable by owner, manager and bookkeeper, writable by nobody', () => {
  const sql = read('supabase/migrations/20261207000000_audit_log.sql');
  assert.ok(sql.includes("using (app_role(farm_id) in ('owner', 'manager', 'bookkeeper'))"));
  assert.ok(!/create policy audit_log_(insert|update|delete)/.test(sql), 'no write policy');
  assert.ok(sql.includes('grant select on audit_log to authenticated') && !/grant (insert|update|delete)[^;]*audit_log/.test(sql));
  assert.ok(sql.includes('security definer') && sql.includes('create trigger'));
  for (const t of ['sales', 'sale_terms', 'movements', 'invoices', 'payables', 'orders', 'freight_orders', 'commodities', 'fields', 'storages']) assert.ok(sql.includes(`'${t}'`), t);
  // a save that changed nothing is not an entry, and a long value is not copied
  assert.ok(sql.includes("if ch = '{}'::jsonb then return null; end if;") && sql.includes('> 200'));
  // the paste-everything script carries the same thing
  const paste = read('supabase/paste-into-sql-editor.sql');
  assert.ok(paste.includes('create table if not exists audit_log') && paste.includes('create or replace function audit_row()') && paste.includes("'audit_' || t"));
});

check('the screen reads the log, pages it, and says so when it is not switched on or there is no signal', () => {
  const v = read('docs/js/views/audit.js');
  for (const t of ["from('audit_log')", '.range(', "order('at', { ascending: false })", 'navigator.onLine', 'is not switched on', 'Show older changes']) assert.ok(v.includes(t), t);
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
