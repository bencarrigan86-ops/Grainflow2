// Run with:
//   node tests/truckcompany.test.mjs
//
// The trucking company on a load: typed on the load (with the companies used before offered), filled in from the freight order's carrier,
// saved in its own optional column, on the load ticket and the load report, merged and audited like the rest of the ticket, in the export,
// and read from a carrier column when loads are imported.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';
import { loadReportRows, reportColumns, buildLoadReportPdf, buildLoadTicketPdf } from '../docs/js/loadreport.js';
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

check('the company is saved with the load, only once there is one, and comes back', () => {
  assert.ok(!('truck_company' in stateToRows(stateWith(base), FARM).movements[0]), 'a load with none sends no column, so it saves before the database has it');
  const rows = stateToRows(stateWith({ ...base, truckCompany: 'Tambo Haulage' }), FARM);
  assert.equal(rows.movements[0].truck_company, 'Tambo Haulage');
  assert.equal(rowsToState(rows).years['2026'].movements[0].truckCompany, 'Tambo Haulage');
  const cleared = stateToRows(stateWith({ ...base, truckCompany: '', __hasTruckCompany: true }), FARM);
  assert.equal(cleared.movements[0].truck_company, null, 'clearing it reaches the server');
});

check('the column is in its own migration and in the paste-in file', () => {
  assert.ok(read('supabase/migrations/20261213000000_movement_truck_company.sql').includes('add column if not exists truck_company text'));
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('add column if not exists truck_company text'));
});

const ctx = { fields: [], storages: [{ id: 's1', name: 'Silo 3' }], sales: [{ id: 'k1', buyer: 'Graincorp', contractNo: 'C-77' }], commodities: [{ id: 'w', name: 'Wheat' }] };
const load = (o) => ({ ...base, commodityId: 'w', froms: [{ type: 'silo', id: 's1' }], tos: [{ type: 'sale', id: 'k1' }], ...o });

check('the load report row carries the company, and the table has a column for it only when some load has one', () => {
  const rows = loadReportRows([load({ id: 'a', truckCompany: 'Tambo Haulage' }), load({ id: 'b', ticketNo: 2 })], ctx);
  assert.equal(rows.find((r) => r.id === 'a').company, 'Tambo Haulage');
  assert.equal(rows.find((r) => r.id === 'b').company, '');
  assert.ok(reportColumns({ showCompany: true }).some((c) => c.key === 'company'));
  assert.ok(!reportColumns({}).some((c) => c.key === 'company'));
  const w = reportColumns({ showCompany: true }).reduce((a, c) => a + c.w, 0);
  assert.ok(w <= 842 - 2 * 24 + 1, 'the columns still fit the page');
  assert.ok(text(buildLoadReportPdf(rows, {})).includes('Carrier'));
  const none = loadReportRows([load({ id: 'b' })], ctx);
  assert.ok(!text(buildLoadReportPdf(none, {})).includes('Carrier'));
});

check('the load ticket shows the company beside the truck and the driver, and is as it was with none', () => {
  const [row] = loadReportRows([load({ id: 'a', truckCompany: 'Tambo Haulage' })], ctx);
  const s = text(buildLoadTicketPdf(row, {}));
  for (const w of ['(TRANSPORT COMPANY)', '(Tambo Haulage)', '(TRUCK)', '(ABC123)', '(DRIVER)', '(Sam)']) assert.ok(s.includes(w), `missing ${w}`);
  const [plain] = loadReportRows([load({ id: 'b' })], ctx);
  const p = text(buildLoadTicketPdf(plain, {}));
  assert.ok(!p.includes('TRANSPORT COMPANY') && p.includes('(TRUCK)') && p.includes('(DRIVER)'));
});

check('the form has the field, with the companies used before and the freight carriers offered, and the freight order fills it in', () => {
  const mv = read('docs/js/views/movements.js');
  assert.ok(mv.includes("id: 'truckCompany'") && mv.includes('dl-companies') && mv.includes("distinctOf(movements, 'truckCompany')"));
  assert.ok(mv.includes("truckCompany: getVal(root, 'truckCompany')?.trim() || ''"), 'saved');
  assert.equal(mv.split("truckCompany: getVal(root, 'truckCompany')").length - 1, 2, 'saved, and on the ticket made from the screen');
  assert.ok(mv.includes('String(fo.carrier || \'\').trim()') && mv.includes('companyAuto'), 'the freight order\'s carrier fills a blank box, or one it filled itself');
  assert.ok(mv.includes('m.truckRego, m.truckCompany, m.driver'), 'searchable');
});

check('it is merged with the rest of a ticket, labelled in the audit trail, and in the export', () => {
  assert.ok(TICKET_FIELDS.some(([k, l]) => k === 'truckCompany' && l === 'Carrier'));
  assert.ok(read('docs/js/audit.js').includes("truck_company: 'Carrier'"));
  assert.ok(read('docs/js/views/settingsexport.js').includes("label: 'Carrier', get: (m) => m.truckCompany ?? ''"));
});

check('a carrier column in a loads file is recognised and goes on the load', () => {
  assert.ok(FIELD_SPECS.some((f) => f.key === 'company'));
  for (const h of ['Carrier', 'Transport Company', 'Transporter', 'Haulier']) {
    assert.equal(guessColumns([h]).company, h, h);
  }
  const li = read('docs/js/loadimport.js');
  assert.ok(li.includes("company: cell(r, 'company')") && li.includes('...(load.company ? { truckCompany: load.company } : {})'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
