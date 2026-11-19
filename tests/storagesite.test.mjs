// Run with:
//   node tests/storagesite.test.mjs
//
// The farm or site a silo, bunker or tally storage sits on: typed on the storage (with the farms already used offered), saved in its own
// optional column, and shown on the load ticket under where a load came from.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';
import { loadReportRows, endPlace, buildLoadTicketPdf } from '../docs/js/loadreport.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const text = (bytes) => Buffer.from(bytes).toString('latin1');

const FARM = '99999999-9999-9999-9999-999999999999';
const stateWith = (st) => ({ currentYear: '2026', nextMovementNo: 5, businessDetails: {}, years: { 2026: { commodities: [], fields: [], sales: [], invoices: [], overheads: {}, storages: [st], movements: [] } } });
const silo = { id: '22222222-2222-2222-2222-222222222222', kind: 'silo', name: 'Silo 3', radius: 3, coneAngle: 30, currentHeight: 5, openingStock: 0 };

check('the farm is saved with the storage, only once there is one, and comes back', () => {
  assert.ok(!('property' in stateToRows(stateWith(silo), FARM).storages[0]), 'none sends no column, so it saves before the database has it');
  const rows = stateToRows(stateWith({ ...silo, property: 'Aralu' }), FARM);
  assert.equal(rows.storages[0].property, 'Aralu');
  assert.equal(rowsToState(rows).years['2026'].storages[0].property, 'Aralu');
  const cleared = stateToRows(stateWith({ ...silo, property: '', __hasProperty: true }), FARM);
  assert.equal(cleared.storages[0].property, null, 'clearing it reaches the server');
});

check('the column is in its own migration and in the paste-in file', () => {
  assert.ok(read('supabase/migrations/20261214000000_storage_property.sql').includes('alter table storages add column if not exists property text'));
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('alter table storages add column if not exists property text'));
});

const ctx = {
  fields: [{ id: 'f1', name: 'Back Block', property: 'Windy Hill' }, { id: 'f2', name: 'Home' }],
  storages: [{ id: 's1', name: 'Silo 3', property: 'Aralu' }, { id: 's2', name: 'Silo 9' }],
  sales: [{ id: 'k1', buyer: 'Graincorp', contractNo: 'C-77' }], commodities: [{ id: 'w', name: 'Wheat' }],
};
const base = { id: 'a', ticketNo: 1, date: '2026-11-16', status: 'open', truckRego: 'ABC123', driver: 'Sam', tons: 30, weightStatus: 'estimate', commodityId: 'w' };

check('a paddock or silo gives its farm or site, and a contract or an unsaid one gives none', () => {
  assert.equal(endPlace({ type: 'silo', id: 's1' }, ctx), 'Aralu');
  assert.equal(endPlace({ type: 'field', id: 'f1' }, ctx), 'Windy Hill');
  assert.equal(endPlace({ type: 'silo', id: 's2' }, ctx), '');
  assert.equal(endPlace({ type: 'field', id: 'f2' }, ctx), '');
  assert.equal(endPlace({ type: 'sale', id: 'k1' }, ctx), '');
  assert.equal(endPlace({ type: 'silo', id: '__transit__' }, ctx), '');
});

check('the load report row carries where it came from and where it went, each place once', () => {
  const [one] = loadReportRows([{ ...base, froms: [{ type: 'silo', id: 's1' }], tos: [{ type: 'sale', id: 'k1' }] }], ctx);
  assert.equal(one.fromPlace, 'Aralu');
  assert.equal(one.goingPlace, '');
  const [two] = loadReportRows([{ ...base, froms: [{ type: 'silo', id: 's1', tons: 10 }, { type: 'silo', id: 's2', tons: 20 }, { type: 'field', id: 'f1', tons: 5 }], tos: [{ type: 'silo', id: 's1' }] }], ctx);
  assert.equal(two.fromPlace, 'Aralu, Windy Hill');
  assert.equal(two.goingPlace, 'Aralu');
  assert.equal(two.fromLegs.find((l) => l.name === 'Silo 9').place, '');
});

check('the load ticket shows the farm under the name, and is as it was with none', () => {
  const [row] = loadReportRows([{ ...base, froms: [{ type: 'silo', id: 's1' }], tos: [{ type: 'sale', id: 'k1' }] }], ctx);
  const s = text(buildLoadTicketPdf(row, {}));
  assert.ok(s.includes('(Silo 3)') && s.includes('(Aralu)'));
  const [plain] = loadReportRows([{ ...base, froms: [{ type: 'silo', id: 's2' }], tos: [{ type: 'sale', id: 'k1' }] }], ctx);
  assert.ok(!text(buildLoadTicketPdf(plain, {})).includes('(Aralu)'));
});

check('the forms have the field, with the farms already used offered, in both the silo and the tally form', () => {
  const sv = read('docs/js/views/storage.js');
  assert.equal(sv.split('${siteField(existing)}').length - 1, 2, 'silo/bunker form and tally form');
  assert.ok(sv.includes("id: 's-property'") && sv.includes('dl-sites') && sv.includes('farmNames(db.get())'));
  assert.equal(sv.split("property: getVal(root, 's-property')?.trim() || ''").length - 1, 2, 'saved from both');
  assert.ok(read('docs/js/storage.js').includes('if (merged.property) merged.__hasProperty = true'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
