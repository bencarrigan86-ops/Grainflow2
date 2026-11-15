// Run with:
//   node tests/storagefees.test.mjs
//
// The storage fee estimate for a third-party site, month by month, beside what the site billed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanFee, feeTermsText, storageFeesByMonth, thisMonthFee } from '../docs/js/storagefees.js';
import { cleanOffFarm, carryOffFarm } from '../docs/js/offfarm.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const loc = (fee, opening = []) => ({ id: 'gc', name: 'GrainCorp Gunnedah', offFarm: { operator: 'GrainCorp', opening, fee } });
const into = (date, tons) => ({ id: `in${date}`, date, froms: [{ type: 'field', id: 'f', tons }], tos: [{ type: 'silo', id: 'gc', tons }] });
const out = (date, tons) => ({ id: `out${date}`, date, froms: [{ type: 'silo', id: 'gc', tons }], tos: [{ type: 'sale', id: 's', tons }] });
const month = (r, m) => r.months.find((x) => x.month === m);

console.log('\n=== the terms ===');
check('terms are cleaned, and no charge at all is null', () => {
  assert.equal(cleanFee(null), null);
  assert.equal(cleanFee({}), null);
  assert.equal(cleanFee({ monthlyRate: 0, receivalRate: '' }), null);
  assert.deepEqual(cleanFee({ monthlyRate: '1.5', basis: 'weird', freeUntil: 'soon', from: '2026-11-01', receivalRate: -3, outturnRate: '2' }),
    { monthlyRate: 1.5, basis: 'month_end', freeUntil: '', from: '2026-11-01', receivalRate: 0, outturnRate: 2 });
  assert.equal(cleanFee({ monthlyRate: 1, basis: 'average' }).basis, 'average');
});
check('the terms read as a line', () => {
  assert.equal(feeTermsText(null), 'No storage charge set');
  assert.equal(feeTermsText({ monthlyRate: 1.5, freeUntil: '2027-04-30', receivalRate: 2, outturnRate: 1 }, (d) => `on ${d}`),
    '$1.50/t a month on the tonnes at month end, free until on 2027-04-30; $2.00/t in; $1.00/t out');
});
check('the terms ride in the off-farm part, and carry into a new season', () => {
  const o = cleanOffFarm({ operator: 'GC', opening: [], fee: { monthlyRate: 2 } });
  assert.equal(o.fee.monthlyRate, 2);
  assert.equal('fee' in cleanOffFarm({ operator: 'GC' }), false, 'no fee key when none is set');
  const next = carryOffFarm({ id: 'gc', offFarm: o }, [], {}, new Map());
  assert.equal(next.fee.monthlyRate, 2);
});

console.log('\n=== the months ===');
check('month end basis: the rate on the tonnes held at each month end', () => {
  const r = storageFeesByMonth(loc({ monthlyRate: 1.5 }), [into('2026-11-10', 100), into('2026-11-20', 50), out('2026-12-05', 30)], [], { today: '2026-12-15' });
  assert.deepEqual(r.months.map((m) => m.month), ['2026-11', '2026-12']);
  assert.equal(month(r, '2026-11').heldEnd, 150);
  assert.equal(month(r, '2026-11').estimate, 225);
  assert.equal(month(r, '2026-12').heldEnd, 120);
  assert.equal(month(r, '2026-12').estimate, 180);
  assert.equal(month(r, '2026-12').current, true);
  assert.equal(r.totals.estimate, 405);
});
check('average basis: tonnes counted for the days they were there', () => {
  // 100 t from 16 Nov of a 30-day month: 15 days at 100 t is an average of 50 t
  const r = storageFeesByMonth(loc({ monthlyRate: 2, basis: 'average' }), [into('2026-11-16', 100)], [], { today: '2026-11-20' });
  assert.equal(month(r, '2026-11').avgHeld, 50);
  assert.equal(month(r, '2026-11').estimate, 100);
});
check('opening stock is held from the first day it is counted', () => {
  const r = storageFeesByMonth(loc({ monthlyRate: 1, from: '2026-10-01' }, [{ commodityId: 'w', grade: 'APH1', tons: 80 }]), [out('2026-11-12', 30)], [], { today: '2026-11-20' });
  assert.deepEqual(r.months.map((m) => [m.month, m.heldEnd, m.estimate]), [['2026-10', 80, 80], ['2026-11', 50, 50]]);
});
check('free until a date: no charge for the free months, month end basis starts when the month end is past it', () => {
  const r = storageFeesByMonth(loc({ monthlyRate: 1, freeUntil: '2026-11-30' }), [into('2026-11-10', 100)], [], { today: '2026-12-10' });
  assert.equal(month(r, '2026-11').estimate, 0);
  assert.equal(month(r, '2026-12').estimate, 100);
});
check('free until part way through a month: the average basis counts only the days after it', () => {
  const r = storageFeesByMonth(loc({ monthlyRate: 3, basis: 'average', freeUntil: '2026-11-15' }), [into('2026-11-01', 60)], [], { today: '2026-11-20' });
  assert.equal(month(r, '2026-11').estimate, 90, '15 of 30 days charged at 60 t x $3');
});
check('receival and outturn charges are $/t on the tonnes that moved in the month', () => {
  const r = storageFeesByMonth(loc({ receivalRate: 2, outturnRate: 1 }), [into('2026-11-03', 100), out('2026-11-25', 40)], [], { today: '2026-11-30' });
  assert.equal(month(r, '2026-11').receival, 200);
  assert.equal(month(r, '2026-11').outturn, 40);
  assert.equal(month(r, '2026-11').estimate, 240);
});
check('loads before the Count from date are not charged, and an over-drawn balance is never a negative fee', () => {
  const r = storageFeesByMonth(loc({ monthlyRate: 1, receivalRate: 5, from: '2026-11-15' }), [into('2026-11-02', 100), out('2026-11-20', 300)], [], { today: '2026-11-30' });
  assert.equal(month(r, '2026-11').receival, 0);
  assert.equal(month(r, '2026-11').heldEnd, 0);
  assert.equal(month(r, '2026-11').estimate, 0);
});

console.log('\n=== set beside the bills ===');
check('a storage bill for this location shows beside its month, with the difference', () => {
  const bills = [
    { id: 'p1', kind: 'storage', storageId: 'gc', invoiceDate: '2026-11-28', amount: 260 },
    { id: 'p2', kind: 'storage', storageId: 'gc', invoiceDate: '2026-11-29', amount: 40 },
    { id: 'p3', kind: 'storage', storageId: 'other', invoiceDate: '2026-11-28', amount: 999 },
    { id: 'p4', kind: 'freight', storageId: 'gc', invoiceDate: '2026-11-28', amount: 999 },
  ];
  const r = storageFeesByMonth(loc({ monthlyRate: 1.5 }), [into('2026-11-10', 150)], bills, { today: '2026-11-30' });
  assert.equal(month(r, '2026-11').billed, 300);
  assert.equal(month(r, '2026-11').difference, 75);
  assert.equal(r.totals.billed, 300);
});
check('a bill in a month with no estimate still shows, and months without a bill are blank', () => {
  const r = storageFeesByMonth(loc({ monthlyRate: 1 }), [into('2026-11-10', 10)], [{ kind: 'storage', storageId: 'gc', invoiceDate: '2026-08-31', amount: 12 }], { today: '2026-12-02' });
  assert.equal(month(r, '2026-08').estimate, 0);
  assert.equal(month(r, '2026-08').billed, 12);
  assert.equal(month(r, '2026-12').billed, null);
  assert.equal(month(r, '2026-12').difference, null);
});
check('no terms, no estimate; the card figure is this month', () => {
  assert.deepEqual(storageFeesByMonth(loc(undefined), [into('2026-11-10', 10)], [], { today: '2026-11-20' }).months, []);
  assert.equal(thisMonthFee(loc({ monthlyRate: 2 }), [into('2026-11-10', 10)], [], '2026-11-20'), 20);
  assert.equal(thisMonthFee(loc(undefined), [], [], '2026-11-20'), 0);
  assert.deepEqual(storageFeesByMonth(null, [], [], { today: '2026-11-20' }).months, []);
  assert.deepEqual(storageFeesByMonth(loc({ monthlyRate: 1 }), [], [], { today: 'not a date' }).months, []);
});

console.log('\n=== the screens ===');
check('the sheet has the terms and the month by month view, shown only to roles that see bills', () => {
  const v = read('docs/js/views/offfarm.js');
  for (const t of ['of-fee-rate', 'of-fee-basis', 'of-fee-free', 'of-fee-from', 'of-fee-in', 'of-fee-out', 'openStorageFeesSheet', 'fees-csv', "['owner', 'manager', 'bookkeeper']", 'existing?.offFarm?.fee']) assert.ok(v.includes(t), t);
});

console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
process.exit(failures ? 1 : 0);
