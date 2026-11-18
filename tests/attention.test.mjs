// Run with:
//   node tests/attention.test.mjs
//
// The "Needs attention" list, the backup reminder, cash flow by month, the buyer statement, a paddock's history across
// the seasons, and the shortcuts and column wired into the screens.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attentionItems } from '../docs/js/attention.js';
import { backupDue, backupAgeText, daysSince, BACKUP_EVERY_DAYS } from '../docs/js/backup.js';
import { cashflow } from '../docs/js/cashflow.js';
import { buyerStatements, statementPdf } from '../docs/js/statement.js';
import { fieldHistory, rotationText, rotationLine, repeatCrops, rotationGrid, cropYields } from '../docs/js/fieldhistory.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const TODAY = '2026-11-16';
const NOW = Date.parse('2026-11-16T09:00:00Z');
const DAY = 86400000;

const sales = [
  { id: 's1', buyer: 'Riverina Grain', contractNo: 'R1', tons: 500, price: 400, deliveryStart: '2026-10-01', deliveryEnd: '2026-11-10' },
  { id: 's2', buyer: 'riverina grain ', contractNo: 'R2', tons: 300, price: 350, deliveryEnd: '2026-12-01' },
  { id: 's3', buyer: 'Coastal Co', contractNo: 'C1', tons: 100, price: 300 },
];
const load = (id, saleId, tons, date) => ({ id, date, tons, tos: [{ type: 'sale', id: saleId, tons }], froms: [] });
const movements = [load('m1', 's1', 200, '2026-10-20'), load('m2', 's2', 50, '2026-11-01')];
const invoices = [
  { id: 'i1', saleId: 's1', invoiceNo: 1, issueDate: '2026-10-01', dueDate: '2026-10-31', totalPayable: 1000, status: 'sent' },
  { id: 'i2', saleId: 's2', invoiceNo: 2, issueDate: '2026-11-10', dueDate: '2026-11-25', totalPayable: 500, status: 'sent' },
  { id: 'i3', saleId: 's3', invoiceNo: 3, issueDate: '2026-09-01', dueDate: '2026-09-30', totalPayable: 99999, status: 'paid' },
];
const payables = [
  { id: 'p1', kind: 'freight', amount: 200, gst: 20, dueDate: '2026-11-01', status: 'unpaid' },
  { id: 'p2', kind: 'other', amount: 100, gst: 10, dueDate: '2027-01-15', status: 'unpaid' },
];

console.log('\n=== needs attention ===');
const items = (extra = {}) => attentionItems({ role: 'owner', today: TODAY, invoices, sales, movements, orders: [], payables, lastBackup: NOW, now: NOW, ...extra });
check('overdue invoices and bills are counted with their money, and tapping opens Receivables & payables', () => {
  const inv = items().find((i) => i.id === 'invoices-overdue');
  assert.match(inv.title, /^1 invoice overdue$/); assert.match(inv.detail, /\$1,000/); assert.equal(inv.action, 'money'); assert.equal(inv.tone, 'bad');
  const bill = items().find((i) => i.id === 'bills-overdue');
  assert.match(bill.title, /^1 bill overdue$/); assert.match(bill.detail, /\$220/, 'a bill owes its GST too');
});
check('a paid invoice is never overdue, and a contract past its end with grain still owed is named', () => {
  assert.ok(!items().some((i) => /99,999/.test(i.detail)));
  const ended = items().find((i) => i.id === 'contracts-ended');
  assert.match(ended.title, /1 contract past the end date/); assert.equal(ended.action, 'deliveries');
});
check('the worst come first', () => {
  const tones = items().map((i) => i.tone);
  assert.deepEqual(tones, [...tones].sort((a, b) => ({ bad: 0, warn: 1, info: 2 }[a] - { bad: 0, warn: 1, info: 2 }[b])));
});
check('only the roles that handle the money see the money, and only the owner is told to back up', () => {
  assert.ok(items({ role: 'manager' }).some((i) => i.id === 'invoices-overdue'));
  assert.deepEqual(items({ role: 'farm_worker', lastBackup: null }), []);
  assert.deepEqual(items({ role: 'driver', lastBackup: null }), []);
  assert.ok(!items({ role: 'manager', lastBackup: null }).some((i) => i.id === 'backup'));
  assert.ok(items({ lastBackup: null }).some((i) => i.id === 'backup'));
});
check('a farm with nothing to look at has an empty list', () => {
  assert.deepEqual(attentionItems({ role: 'owner', today: TODAY, lastBackup: NOW, now: NOW }), []);
});

console.log('\n=== the backup reminder ===');
check('due once there are records and it has been a month, or never', () => {
  assert.equal(backupDue({ last: null, hasRecords: true, now: NOW }), true);
  assert.equal(backupDue({ last: null, hasRecords: false, now: NOW }), false, 'an empty farm has nothing to back up');
  assert.equal(backupDue({ last: NOW - 5 * DAY, hasRecords: true, now: NOW }), false);
  assert.equal(backupDue({ last: NOW - BACKUP_EVERY_DAYS * DAY, hasRecords: true, now: NOW }), true);
});
check('the age reads in words', () => {
  assert.equal(backupAgeText(null, NOW), 'never');
  assert.equal(backupAgeText(NOW - 3600000, NOW), 'today');
  assert.equal(backupAgeText(NOW - DAY, NOW), 'yesterday');
  assert.equal(backupAgeText(NOW - 12 * DAY, NOW), '12 days ago');
  assert.equal(daysSince(null, NOW), null);
});

console.log('\n=== cash flow ===');
const cf = cashflow(invoices, sales, payables, TODAY, 3);
check('what is overdue is one line at the top, the months follow, and the running balance carries down', () => {
  assert.deepEqual(cf.rows.map((r) => r.key), ['overdue', '2026-11', '2026-12', '2027-01']);
  const by = Object.fromEntries(cf.rows.map((r) => [r.key, r]));
  assert.equal(by.overdue.in, 1000); assert.equal(by.overdue.out, 220);
  assert.equal(by['2026-11'].in, 500);
  assert.equal(by['2027-01'].out, 110);
  assert.equal(by['2027-01'].balance, 1000 - 220 + 500 - 110);
});
check('totals add up, and a paid invoice is not in it', () => {
  assert.equal(cf.totalIn, 1500); assert.equal(cf.totalOut, 330); assert.equal(cf.net, 1170);
  assert.equal(cf.rows.length, 4, 'a line for later or no date appears only when it holds something');
});
check('a bill with no date has its own line, and one past the window is "later"', () => {
  const c = cashflow([], sales, [{ id: 'p', amount: 50, gst: 0, status: 'unpaid' }, { id: 'q', amount: 70, gst: 0, dueDate: '2028-01-01', status: 'unpaid' }], TODAY, 2);
  assert.equal(c.rows.find((r) => r.key === 'nodate').out, 50);
  assert.equal(c.rows.find((r) => r.key === 'later').out, 70);
});

console.log('\n=== statement by buyer ===');
const sts = buyerStatements(invoices, sales, movements, TODAY);
check('one statement per buyer, the same name in any capitals together, the biggest debt first', () => {
  assert.deepEqual(sts.map((s) => s.key), ['riverina grain'], 'a buyer who owes nothing has no statement');
  const r = sts.find((s) => s.key === 'riverina grain');
  assert.equal(r.unpaid.length, 2); assert.equal(r.unpaidTotal, 1500); assert.equal(r.overdueTotal, 1000);
});
check('grain delivered but not invoiced is added at the contract price', () => {
  const r = sts.find((s) => s.key === 'riverina grain');
  assert.equal(r.notInvoicedTons, 250);
  assert.equal(r.notInvoicedValue, 200 * 400 + 50 * 350);
  assert.equal(r.owing, 1500 + 200 * 400 + 50 * 350);
});
check('the PDF is a real file with the buyer and the total on it', () => {
  const bytes = statementPdf(sts[0], { businessName: 'A Farm', abn: '11 222', today: TODAY });
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.startsWith('%PDF-') && text.trimEnd().endsWith('%%EOF'));
  assert.ok(text.includes('Riverina Grain') && text.includes('STATEMENT'));
});

console.log('\n=== a paddock across the seasons ===');
const years = {
  2025: { commodities: [{ id: 'w', name: 'Wheat' }], fields: [{ id: 'a', name: 'Top Block', areaHa: 100, commodityId: 'w', yieldTHa: 3 }], movements: [] },
  2026: { commodities: [{ id: 'w2', name: 'Wheat' }, { id: 'c', name: 'Canola' }], fields: [{ id: 'b', name: ' top block ', areaHa: 100, commodityId: 'w2', yieldTHa: 3.5 }, { id: 'z', name: 'Other', areaHa: 5, commodityId: 'c' }], movements: [] },
  2027: { commodities: [{ id: 'c3', name: 'Canola' }], fields: [{ id: 'd', name: 'Top Block', areaHa: 90, commodityId: 'c3', yieldTHa: 2 }], movements: [] },
};
check('the paddock is found in each season by its name and the rows run oldest first', () => {
  const rows = fieldHistory('Top Block', years);
  assert.deepEqual(rows.map((r) => [r.year, r.crop, r.areaHa]), [['2025', 'Wheat', 100], ['2026', 'Wheat', 100], ['2027', 'Canola', 90]]);
  assert.equal(rows[1].tons, 350); assert.equal(rows[1].yieldTHa, 3.5);
  assert.deepEqual(fieldHistory('Nowhere', years), []);
  assert.deepEqual(fieldHistory('', years), []);
});
check('the rotation reads in a line, and the same crop twice running is spotted', () => {
  const rows = fieldHistory('Top Block', years);
  assert.equal(rotationText(rows), 'Wheat, then wheat, then canola');
  assert.equal(rotationLine(rows), rows.map((r) => r.year + ' ' + r.crop).join(', '), 'the season first, then its crop');
  assert.deepEqual(repeatCrops(rows), [['2025', '2026']]);
});

console.log('\n=== rotation and yield, every paddock and season ===');
const grid = rotationGrid({
  2025: { commodities: [{ id: 'w', name: 'Wheat' }], fields: [{ id: 'a', name: 'Top Block', property: 'Home', areaHa: 100, commodityId: 'w', yieldTHa: 3 }, { id: 'b', name: 'Dam Paddock', property: 'Home', areaHa: 50, commodityId: 'w', yieldTHa: 2 }], movements: [] },
  2026: { commodities: [{ id: 'w2', name: 'Wheat' }, { id: 'c', name: 'Canola' }], fields: [{ id: 'a2', name: 'top block', property: 'Home', areaHa: 100, commodityId: 'w2', yieldTHa: 4 }, { id: 'n', name: 'New Land', property: 'River', areaHa: 20, commodityId: 'c', yieldTHa: 2 }], movements: [] },
});
check('one row per paddock across the seasons, by name, farms together, a new paddock has only the seasons it was in', () => {
  assert.deepEqual(grid.seasons, ['2025', '2026']);
  assert.deepEqual(grid.rows.map((r) => r.name), ['Dam Paddock', 'Top Block', 'New Land']);
  const top = grid.rows.find((r) => r.name === 'Top Block');
  assert.deepEqual(Object.keys(top.cells), ['2025', '2026']);
  assert.equal(top.cells['2026'].yieldTHa, 4);
  assert.deepEqual(Object.keys(grid.rows.find((r) => r.name === 'New Land').cells), ['2026']);
  assert.deepEqual(Object.keys(grid.rows.find((r) => r.name === 'Dam Paddock').cells), ['2025'], 'a paddock dropped from a season has no cell for it');
});
check('the crops are listed, and a repeated crop is marked on the paddock', () => {
  assert.deepEqual(grid.crops, ['Canola', 'Wheat']);
  assert.deepEqual(grid.rows.find((r) => r.name === 'Top Block').repeats, [['2025', '2026']]);
  assert.deepEqual(grid.rows.find((r) => r.name === 'New Land').repeats, []);
});
check('a crop\'s farm yield is total tonnes over total hectares, season by season', () => {
  const wheat = cropYields(grid).find((y) => y.crop === 'Wheat');
  assert.equal(wheat.bySeason['2025'].areaHa, 150);
  assert.ok(Math.abs(wheat.bySeason['2025'].yieldTHa - (300 + 100) / 150) < 1e-9);
  assert.equal(wheat.bySeason['2026'].yieldTHa, 4);
  assert.equal(cropYields(grid).find((y) => y.crop === 'Canola').bySeason['2025'], undefined);
});
check('nothing to show for a farm with no paddocks', () => {
  assert.deepEqual(rotationGrid({}).rows, []);
  assert.deepEqual(rotationGrid({ 2026: { fields: [], commodities: [] } }).seasons, ['2026']);
});

console.log('\n=== on the screens ===');
check('Position shows the list and opens what it names', () => {
  const p = read('docs/js/views/position.js');
  assert.ok(p.includes('attentionCard()') && p.includes('openMoneySheet()') && p.includes('openDeliveriesSheet()'));
});
check('Settings says when the last backup was, and the export remembers it', () => {
  const s = read('docs/js/views/settings.js');
  assert.ok(s.includes('id="last-backup"') && s.includes('downloadBackup(db.exportJSON())'));
});
check('Invoices has the month view; MTM is a report of its own with the buyer statements', () => {
  const o = read('docs/js/views/outstanding.js');
  assert.ok(o.includes('data-side="month"') && !o.includes('data-side="buyer"') && o.includes('data-statement'));
  assert.ok(o.includes('export function openMtmSheet()') && o.includes("openSheet('MTM'"));
  assert.ok(read('docs/js/reportshub.js').includes("tile('mtm', 'MTM', 'sheet')") && read('docs/js/views/reports.js').includes('mtm: () => openMtmSheet()'));
});
check('the paddock sheet has the history, and a paddock or a contract can start a movement', () => {
  assert.ok(read('docs/js/views/production.js').includes('historyHtml(existing, showYield)'));
  const m = read('docs/js/views/movements.js');
  assert.ok(m.includes('data-new-movement') && m.includes("tos: [{ type: 'sale', id, tons: '' }]") && m.includes("froms: [{ type: 'field', id, tons: '' }]"));
});
check('Reports opens the rotation report whenever there are paddocks, even for one season', () => {
  const p = read('docs/js/views/reports.js');
  assert.ok(read('docs/js/reportshub.js').includes("hasFields && can('production') && tile('rotation'") && p.includes('rotation: () => openRotationSheet()'));
  assert.ok(!read('docs/js/views/production.js').includes('id="open-reports"'), 'the Reports button is gone from the top of Production');
  const v = read('docs/js/views/rotation.js');
  assert.ok(v.includes('rotationGrid(years)') && v.includes('areaSummary(grid)') && v.includes('canSeeYield'), 'yields are shown only to roles that may see them');
});
check('the Production table has a share-of-area column that totals 100%', () => {
  const p = read('docs/js/views/production.js');
  assert.ok(p.includes('<th>% of area</th>') && p.includes('areaShare(r.area, productionTotals.area)') && p.includes("'100%'"));
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
