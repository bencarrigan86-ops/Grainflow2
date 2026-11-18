// Run with:
//   node tests/help.test.mjs
//
// The how-to guide's "who can do what" against the things that really decide it: the tab bar (nav.js) and the database's own
// policies (supabase/migrations). The guide is a promise to people about what they can do; this fails if it drifts from the
// rules.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROLES, tabsForRole, canOpen } from '../docs/js/nav.js';
import { INVITABLE_ROLES } from '../docs/js/invites.js';
import { figureFor, tabsSvg, rolesSvg, FIGURE_IDS } from '../docs/js/helpvisuals.js';
import { ACCESS, LEVELS, ROLE_INFO, GUIDES, guidesForRole, accessFor, startProgress, START_STEPS } from '../docs/js/helpcontent.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// table -> roles each kind of policy admits (null = every member)
function policies(kind) {
  const out = new Map();
  const dir = join(ROOT, 'supabase', 'migrations');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = read(`supabase/migrations/${f}`);
    for (const m of sql.matchAll(new RegExp(`create policy \\w+_${kind} on (\\w+) for ${kind}\\s*([\\s\\S]*?);`, 'g'))) {
      const named = [...new Set([...m[2].matchAll(/'(owner|manager|bookkeeper|farm_worker|driver)'/g)].map((x) => x[1]))];
      out.set(m[1], named.length ? named : null);
    }
  }
  return out;
}
const sel = policies('select');
const ins = policies('insert');
const area = (name) => ACCESS.find((r) => r.area === name);
const who = (row, ...levels) => ROLES.filter((r) => levels.includes(row[r]));

console.log('\n=== the table is complete ===');
check('every area gives every role a level, and every role has a summary', () => {
  for (const r of ACCESS) for (const role of ROLES) assert.ok(LEVELS[r[role]], `${r.area} has no level for ${role}`);
  assert.deepEqual(ROLE_INFO.map((r) => r.role), ROLES);
  for (const r of ROLE_INFO) assert.ok(r.summary && r.only, `${r.role} is missing words`);
});
check('accessFor gives a row per area', () => {
  assert.equal(accessFor('driver').length, ACCESS.length);
  assert.equal(accessFor('driver').find((r) => r.area === 'Loads and tickets').level, 'own');
});

console.log('\n=== against the tab bar ===');
check('an area with a tab is closed to a role with no such tab, and open to one that has it', () => {
  for (const r of ACCESS.filter((x) => x.tab)) {
    for (const role of ROLES) {
      const has = tabsForRole(role).includes(r.tab);
      assert.equal(r[role] !== 'none', has, `${r.area}: ${role} ${has ? 'has' : 'has no'} the ${r.tab} tab but the guide says ${r[role]}`);
    }
  }
});

console.log('\n=== against the database policies ===');
check('what the money tables send is what the guide says can see them', () => {
  const sees = (table) => (sel.get(table) === null ? ROLES : sel.get(table));
  assert.deepEqual(sees('invoices').sort(), who(area('Invoices'), 'full', 'view').sort());
  assert.deepEqual(sees('overheads').sort(), who(area('Overheads'), 'full', 'view').sort());
  assert.deepEqual(sees('payables').sort(), who(area('Bills'), 'full', 'view').sort());
  assert.deepEqual(sees('sale_terms').sort(), ['bookkeeper', 'owner'], 'prices are owner and bookkeeper only');
  assert.deepEqual(sees('spray_jobs').sort(), who(area('Spray requests'), 'full', 'view').sort());
  assert.deepEqual(sees('input_stock').sort(), who(area('Inputs and spraying'), 'full', 'view', 'used').sort());
  assert.deepEqual(sees('freight_orders').sort(), who(area('Grain orders and freight orders'), 'full', 'view').sort());
});
check('who can add things is who the guide says can add and change', () => {
  assert.deepEqual(ins.get('sales').sort(), who(area('Contracts and prices'), 'full').sort());
  assert.deepEqual(ins.get('invoices').sort(), who(area('Invoices'), 'full').sort());
  assert.deepEqual(ins.get('payables').sort(), who(area('Bills'), 'full').sort());
  assert.deepEqual(ins.get('spray_jobs').sort(), who(area('Spray requests'), 'full').sort());
  assert.deepEqual(ins.get('input_stock').sort(), who(area('Inputs and spraying'), 'full', 'used').sort());
  assert.deepEqual(ins.get('storages').sort(), who(area('Storage'), 'full').sort());
  assert.deepEqual(ins.get('freight_orders').sort(), who(area('Grain orders and freight orders'), 'full').sort());
  assert.deepEqual(ins.get('movements').sort(), who(area('Loads and tickets'), 'full', 'own').sort());
  assert.deepEqual(ins.get('overheads').sort(), who(area('Overheads'), 'full').sort());
});
check('only an owner runs the people list', () => {
  assert.deepEqual(ins.get('farm_users'), ['owner']);
  assert.deepEqual(who(area('People'), 'full', 'view'), ['owner']);
});

console.log('\n=== the guides ===');
check('every guide has steps, valid roles, and a place to open that someone who sees it can reach', () => {
  const ids = new Set();
  for (const g of GUIDES) {
    assert.ok(!ids.has(g.id), `duplicate guide ${g.id}`); ids.add(g.id);
    assert.ok(g.title && g.blurb && g.steps.length >= 2, `${g.id} is thin`);
    assert.ok(g.roles.length && g.roles.every((r) => ROLES.includes(r)), `${g.id} has a bad role`);
    if (g.open) assert.ok(g.roles.some((r) => canOpen(r, g.open)), `${g.id} opens ${g.open}, which none of its readers can reach`);
  }
});
check('every role has guides, and nobody is shown a guide for a part of the app they cannot use', () => {
  for (const role of ROLES) assert.ok(guidesForRole(role).length >= 2, `${role} has almost nothing`);
  const driver = guidesForRole('driver').map((g) => g.id);
  assert.ok(driver.includes('load') && driver.includes('offline'));
  for (const hidden of ['contracts', 'invoices', 'spray', 'people', 'inputs']) assert.ok(!driver.includes(hidden), `a driver is shown ${hidden}`);
  assert.ok(!guidesForRole('farm_worker').some((g) => ['invoices', 'contracts', 'people'].includes(g.id)));
  assert.ok(guidesForRole('owner').some((g) => g.id === 'people'));
  assert.ok(guidesForRole('manager').some((g) => g.id === 'invoices'), 'a manager can invoice');
});

console.log('\n=== getting started ===');
const empty = { business: {}, commodities: [], fields: [], storages: [], sales: [], movements: [], invoices: [] };
check('a new farm has nothing ticked, and the steps are those the role can do', () => {
  const p = startProgress('owner', empty);
  assert.equal(p.done, 0); assert.equal(p.total, START_STEPS.length); assert.equal(p.complete, false);
  assert.deepEqual(startProgress('bookkeeper', empty).steps.map((s) => s.id), ['contract', 'invoice']);
  assert.ok(!startProgress('manager', empty).steps.some((s) => s.id === 'contract'));
  assert.equal(startProgress('driver', empty).steps.length, 0, 'a driver is not given a checklist');
});
check('each step ticks itself when the farm has the thing', () => {
  const full = { business: { entityName: 'A Farm', abn: '1' }, commodities: [{}], fields: [{}], storages: [{}], sales: [{}], movements: [{}], invoices: [{}] };
  const p = startProgress('owner', full);
  assert.equal(p.done, p.total); assert.equal(p.complete, true);
  assert.equal(startProgress('owner', { ...empty, fields: [{}] }).steps.find((s) => s.id === 'paddocks').done, true);
});

console.log('\n=== on the screens ===');
check('Help is reachable by every role, from Account and Settings, and the Position card links to it', () => {
  for (const role of ROLES) assert.ok(canOpen(role, 'help'), `${role} cannot open help`);
  assert.ok(read('docs/js/main.js').includes("{ id: 'help', label: 'Help', render: renderHelp }"));
  assert.ok(read('docs/js/views/account.js').includes('id="open-help"'));
  assert.ok(read('docs/js/views/settings.js').includes('id="open-help"'));
  const p = read('docs/js/views/position.js');
  assert.ok(p.includes('startProgress(') && p.includes('id="start-help"') && p.includes('id="start-hide"'));
});

console.log('\n=== the invite words and Settings agree with the table ===');
check('the invite screen does not say a manager is kept from what they can do', () => {
  const blurb = (r) => INVITABLE_ROLES.find((x) => x.value === r).blurb;
  assert.ok(/invoices/i.test(blurb('manager')) && /bills/i.test(blurb('manager')), 'a manager handles invoices and bills');
  assert.ok(/contract prices/i.test(blurb('manager')) && /bank/i.test(blurb('manager')));
  assert.ok(/overheads/i.test(blurb('bookkeeper')) && /invoic/i.test(blurb('bookkeeper')));
});
check('only the owner edits the business details; a manager is not shown the bank details', () => {
  const s = read('docs/js/views/settings.js');
  assert.ok(s.includes("const canEditBusiness = db.getRole() === 'owner';") && s.includes("const seesBank = ['owner', 'bookkeeper'].includes(db.getRole());"));
  assert.ok(s.includes("${seesBank ? `<hr class=\"sep\" />") && s.includes("id=\"save-business\">Save business details</button>' : ''"));
  assert.ok(/farms_update on farms for update\s+using \(app_role\(id\) = 'owner'\)/.test(read('supabase/migrations/20260831130000_rls_policies.sql')), 'the server lets only the owner edit the farm');
  assert.ok(area('Settings').note.includes('business and bank details by the owner only'));
});

console.log('\n=== the pictures ===');
check('every figure draws, with no gaps in it, and belongs to a guide', () => {
  for (const id of FIGURE_IDS) {
    const s = figureFor(id);
    assert.ok(s.startsWith('<svg') && s.endsWith('</svg>'), `${id} is not an svg`);
    assert.ok(!/undefined|NaN|null/.test(s), `${id} has a gap in it`);
    assert.ok(/aria-label="[^"]{10,}"/.test(s), `${id} has no description for a screen reader`);
    assert.ok(GUIDES.some((g) => g.id === id), `${id} is a picture for no guide`);
  }
  assert.equal(figureFor('nothing'), '');
});
check('the tab bar picture shows exactly the tabs that role has', () => {
  const labels = { position: 'Position', production: 'Production', sales: 'Sales', movement: 'Movement', storage: 'Storage', reports: 'Reports' };
  for (const role of ROLES) {
    const s = tabsSvg(role);
    for (const t of tabsForRole(role)) assert.ok(s.includes(`>${labels[t]}<`), `${role} bar is missing ${t}`);
    for (const t of Object.keys(labels).filter((k) => !tabsForRole(role).includes(k))) assert.ok(!s.includes(`>${labels[t]}<`), `${role} bar shows ${t}`);
  }
  const all = rolesSvg();
  for (const name of ['Owner', 'Manager', 'Book-keeper', 'Worker', 'Driver']) assert.ok(all.includes(`>${name}<`));
});
check('the guide shows its picture, the access table is chips, and the role bars are on the page', () => {
  const v = read('docs/js/views/help.js');
  assert.ok(v.includes('figureFor(g.id)') && v.includes('tabsSvg(role)') && v.includes('rolesSvg()') && v.includes('pill(r[k])'));
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
