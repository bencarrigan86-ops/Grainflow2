// Run with:
//   node tests/driverphone.test.mjs
//
// The driver's phone number on a load: typed on the load (filled in from the same driver's last load), saved in its own optional
// column, under the driver on the load ticket, merged and audited like the rest of the ticket, in the export, and read from a phone
// column when loads are imported.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';
import { loadReportRows, buildLoadTicketPdf } from '../docs/js/loadreport.js';
import { guessColumns, FIELD_SPECS } from '../docs/js/loadmap.js';
import { TICKET_FIELDS } from '../docs/js/ticketmerge.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const text = (bytes) => Buffer.from(bytes).toString('latin1');

const FARM = '99999999-9999-9999-9999-999999999999';
const stateWith = (m) => ({ currentYear: '2026', nextMovementNo: 5, businessDetails: {}, years: { 2026: { commodities: [], fields: [], sales: [], invoices: [], overheads: {}, storages: [], movements: [m] } } });
const base = { id: '11111111-1111-1111-1111-111111111111', ticketNo: 1, date: '2026-11-16', status: 'open', truckRego: 'ABC123', driver: 'Sam', tons: 30, weightStatus: 'estimate', froms: [], tos: [] };

check('the phone is saved with the load, only once there is one, and comes back', () => {
  assert.ok(!('driver_phone' in stateToRows(stateWith(base), FARM).movements[0]), 'a load with none sends no column, so it saves before the database has it');
  const rows = stateToRows(stateWith({ ...base, driverPhone: '0412 345 678' }), FARM);
  assert.equal(rows.movements[0].driver_phone, '0412 345 678');
  assert.equal(rowsToState(rows).years['2026'].movements[0].driverPhone, '0412 345 678');
  const cleared = stateToRows(stateWith({ ...base, driverPhone: '', __hasDriverPhone: true }), FARM);
  assert.equal(cleared.movements[0].driver_phone, null, 'clearing it reaches the server');
});

check('the column is in its own migration and in the paste-in file', () => {
  assert.ok(read('supabase/migrations/20261216000000_movement_driver_phone.sql').includes('add column if not exists driver_phone text'));
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('add column if not exists driver_phone text'));
});

const ctx = { fields: [], storages: [{ id: 's1', name: 'Silo 3' }], sales: [{ id: 'k1', buyer: 'Graincorp', contractNo: 'C-77' }], commodities: [{ id: 'w', name: 'Wheat' }] };
const load = (o) => ({ ...base, commodityId: 'w', froms: [{ type: 'silo', id: 's1' }], tos: [{ type: 'sale', id: 'k1' }], ...o });

check('the load ticket shows the phone under the driver, with or without a transport company, and is as it was with none', () => {
  for (const extra of [{}, { truckCompany: 'Tambo Haulage' }]) {
    const [row] = loadReportRows([load({ id: 'a', driverPhone: '0412 345 678', ...extra })], ctx);
    assert.equal(row.driverPhone, '0412 345 678');
    const s = text(buildLoadTicketPdf(row, {}));
    assert.ok(s.includes('(DRIVER)') && s.includes('(Sam)') && s.includes('(0412 345 678)'), JSON.stringify(extra));
  }
  const [plain] = loadReportRows([load({ id: 'b' })], ctx);
  assert.equal(plain.driverPhone, '');
  assert.ok(!text(buildLoadTicketPdf(plain, {})).includes('(04'));
});

check('the form has the field, saves it, searches it, and fills it in from the same driver\'s last load', () => {
  const mv = read('docs/js/views/movements.js');
  assert.ok(mv.includes("id: 'driverPhone'") && mv.includes("type: 'tel'"));
  assert.equal(mv.split("driverPhone: getVal(root, 'driverPhone')").length - 1, 2, 'saved, and on the ticket made from the screen');
  assert.ok(mv.includes('m.truckCompany, m.driver, m.driverPhone'), 'searchable');
  assert.ok(mv.includes('phoneAuto') && mv.includes("root.querySelector('#driver')?.addEventListener('change'"));
});

check('it is merged with the rest of a ticket, labelled in the audit trail, and in the export', () => {
  assert.ok(TICKET_FIELDS.some(([k, l]) => k === 'driverPhone' && l === 'Driver phone'));
  assert.ok(read('docs/js/audit.js').includes("driver_phone: 'Driver phone'"));
  assert.ok(read('docs/js/views/settingsexport.js').includes("label: 'Driver phone', get: (m) => m.driverPhone ?? ''"));
});

check('a phone column in a loads file is recognised and goes on the load', () => {
  assert.ok(FIELD_SPECS.some((f) => f.key === 'driverPhone'));
  for (const h of ['Driver Phone', 'Mobile', 'Phone Number', 'Driver Mobile']) assert.equal(guessColumns([h]).driverPhone, h, h);
  const li = read('docs/js/loadimport.js');
  assert.ok(li.includes("driverPhone: cell(r, 'driverPhone')") && li.includes('...(load.driverPhone ? { driverPhone: load.driverPhone } : {})'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
