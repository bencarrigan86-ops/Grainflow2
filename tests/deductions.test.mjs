// Run with:
//   node tests/deductions.test.mjs
//
// A deduction on a load's ticket (a fault the contract does not price) comes off its price on the invoice, with the reason under it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanDeductions, deductionPerTon, deductionRateFor, deductionAdjustment, deductionNotes, hasDeductions } from '../docs/js/deductions.js';
import { invoiceLineItems, invoiceTotals, saleEconomics } from '../docs/js/derived.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${(e.stack || e.message).split('\n').slice(0, 3).join('\n        ')}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const sale = { id: 's1', price: 400, tons: 100, contractNo: 'C1' };
const load = (id, tons, deductions) => ({ id, date: '2026-11-10', truckRego: 'ABC123', tons, froms: [], tos: [{ type: 'sale', id: 's1', tons }], ...(deductions ? { deductions } : {}) });

check('the list is tidied: reasons trimmed, amounts to the cent, empty ones dropped', () => {
  assert.deepEqual(cleanDeductions([{ reason: '  Screenings 6% vs 5% ', perTon: '10' }, { reason: '', perTon: 0 }, { reason: 'x', perTon: 'abc' }]),
    [{ reason: 'Screenings 6% vs 5%', perTon: 10 }, { reason: 'x', perTon: 0 }]);
  assert.deepEqual(cleanDeductions(undefined), []);
  assert.equal(hasDeductions({}), false);
  assert.equal(hasDeductions(load('a', 30, [{ reason: 'r', perTon: 5 }])), true);
});

check('several deductions add up per tonne, and the rate moves the other way', () => {
  const m = load('a', 30, [{ reason: 'Screenings', perTon: 10 }, { reason: 'Moisture', perTon: 2.5 }]);
  assert.equal(deductionPerTon(m), 12.5);
  assert.equal(deductionRateFor(m), -12.5);
  assert.equal(deductionRateFor(load('b', 30)), 0, 'none is nothing, not -0 or NaN');
  assert.equal(deductionRateFor(load('c', 30, [{ reason: 'Bonus', perTon: -4 }])), 4, 'a minus adds to the price');
});

check('the invoice line pays the load at the price less the deduction, and keeps the reason', () => {
  const lines = invoiceLineItems(sale, [load('a', 30, [{ reason: 'Screenings 6% vs contract 5%', perTon: 10 }]), load('b', 20)]);
  const a = lines.find((l) => l.movementId === 'a');
  const b = lines.find((l) => l.movementId === 'b');
  assert.equal(a.rate, 390);
  assert.equal(a.adjust, -10);
  assert.equal(a.subtotal, 30 * 390);
  assert.deepEqual(a.deductions, [{ reason: 'Screenings 6% vs contract 5%', perTon: 10 }]);
  assert.equal(b.rate, 400);
  assert.ok(!('deductions' in b), 'a load without any has no note');
  assert.equal(invoiceTotals(sale, lines).subtotalExGST, 30 * 390 + 20 * 400);
});

check('the contract value counts the deductions on the loads delivered so far', () => {
  const moves = [load('a', 30, [{ reason: 'Screenings', perTon: 10 }]), load('b', 20)];
  assert.deepEqual(deductionAdjustment(sale, moves), { total: -300, loads: 1 });
  const e = saleEconomics(sale, moves);
  assert.equal(e.deductionAdjustment, -300);
  assert.equal(e.totalValue, saleEconomics(sale, []).totalValue - 300);
  assert.equal(deductionAdjustment(sale, [{ ...load('a', 30, [{ reason: 's', perTon: 10 }]), tos: [{ type: 'sale', id: 'other', tons: 30 }] }]).total, 0, 'only tonnes to this contract');
});

check('the note under the load says what it is, the $/t and the dollars', () => {
  assert.deepEqual(deductionNotes([{ reason: 'screenings', perTon: 10 }]), ['-$10.00/t discount for screenings']);
  assert.deepEqual(deductionNotes([{ reason: 'Screenings 6% vs contract 5%', perTon: 10 }], 30), ['-$10.00/t discount for Screenings 6% vs contract 5% (-$300.00)']);
  assert.deepEqual(deductionNotes([{ reason: 'high oil', perTon: -4 }]), ['+$4.00/t premium for high oil']);
  assert.deepEqual(deductionNotes([{ reason: '', perTon: 3 }]), ['-$3.00/t discount']);
  assert.deepEqual(deductionNotes([]), []);
});

check('the deductions go to the server and come back; no column is sent for a load that never had any', () => {
  const st = (m) => ({ currentYear: '2026', years: { 2026: { sales: [], commodities: [], fields: [], storages: [], movements: [m] } }, businessDetails: {} });
  const base = { id: 'm1', date: '2026-11-17', tons: 30, froms: [], tos: [] };
  const d = [{ reason: 'Screenings 6% vs contract 5%', perTon: 10 }];
  const rows = stateToRows(st({ ...base, deductions: d }), 'farm1');
  assert.deepEqual(rows.movements[0].deductions, d);
  const back = rowsToState(rows).years[2026].movements[0];
  assert.deepEqual(back.deductions, d);
  assert.ok(!('deductions' in stateToRows(st(base), 'farm1').movements[0]));
  assert.equal(stateToRows(st({ ...back, deductions: [] }), 'farm1').movements[0].deductions, null, 'removing the last one reaches the server');
});

check('the ticket has the section, saves it, and the invoice, the Xero export and the column are wired', () => {
  const m = read('docs/js/views/movements.js');
  assert.ok(m.includes('id="ded-fold"') && m.includes('id="ded-add"') && m.includes('deductions: readDeductions(root.querySelector(\'#ded-rows\'))'));
  assert.ok(m.indexOf('id="ded-fold"') > m.indexOf('id="lq-fold"') && m.indexOf('id="ded-fold"') < m.indexOf('id="np-fold"'), 'between quality and notes');
  assert.ok(read('docs/js/views/invoice.js').includes('deductionNotes(l.deductions, l.tons)') && read('docs/js/views/invoice.js').includes('class="ded-note"'));
  assert.ok(read('docs/js/xero.js').includes('deductionNotes(l.deductions)'));
  assert.ok(read('docs/js/storage.js').includes('rec.__hasDeductions = true'));
  assert.ok(read('supabase/migrations/20261126000000_movement_deductions.sql').includes('add column if not exists deductions jsonb'));
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('add column if not exists deductions jsonb'));
  assert.ok(read('docs/css/styles.css').includes('.invoice-doc tr.ded-note td'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
