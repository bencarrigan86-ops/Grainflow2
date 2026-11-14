// Run with:
//   node tests/recorddocs.test.mjs
//
// Files attached to an order, an invoice or a bill: they go to the server as their own rows, come back on the
// right record, travel with the record that owns them (and only that one), and are only written by roles that may.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';
import { selectDirtyRows } from '../docs/js/dirty.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const FARM = '11111111-1111-1111-1111-111111111111';
const SALE = '41414141-4141-4141-4141-414141414141';
const OID = '51515151-5151-5151-5151-515151515151';
const OID2 = '52525252-5252-5252-5252-525252525252';
const PID = '99999999-9999-9999-9999-999999999999';
const IID = '77777777-7777-7777-7777-777777777777';
const doc = (id, kind, name) => ({ id, kind, fileName: name, storagePath: `${FARM}/x/${id}.pdf`, byteSize: 2048, uploadedAt: '2026-11-14T01:02:03.000Z' });
const D1 = doc('d1000000-0000-0000-0000-000000000001', 'order', 'PO 77.pdf');
const D2 = doc('d2000000-0000-0000-0000-000000000002', 'bill', 'Jones Nov.pdf');
const D3 = doc('d3000000-0000-0000-0000-000000000003', 'remittance', 'remit.pdf');
const D4 = doc('d4000000-0000-0000-0000-000000000004', 'order', 'PO 78.pdf');

const order = (id, documents) => ({ id, saleId: SALE, orderNo: 'PO', tons: 100, deliverFrom: '', deliverBy: '', freightCompany: '', status: 'open', notes: '', ...(documents ? { documents } : {}) });
const bill = (documents) => ({ id: PID, kind: 'freight', supplier: 'Jones', reference: '', invoiceDate: '', dueDate: '', amount: 100, gst: 10, saleId: null, storageId: null, tons: '', rate: '', status: 'unpaid', paidDate: '', notes: '', ...(documents ? { documents } : {}) });
const invoice = (documents) => ({ id: IID, saleId: SALE, invoiceNo: 1, status: 'outstanding', paidDate: null, lines: [], totals: {}, ...(documents ? { documents } : {}) });
const state = (extra) => ({
  currentYear: '2026', nextMovementNo: 1, businessDetails: {},
  years: { 2026: { commodities: [], storages: [], fields: [], sales: [], movements: [], overheads: {}, invoices: [], payables: [], orders: [], ...extra } },
});

console.log('\n=== saving and loading ===');

check('an order, a bill and an invoice each send their files as rows naming what they belong to', () => {
  const rows = stateToRows(state({ orders: [order(OID, [D1])], payables: [bill([D2])], invoices: [invoice([D3])] }), FARM);
  const by = (t) => rows.record_documents.filter((r) => r.parent_type === t);
  assert.equal(rows.record_documents.length, 3);
  assert.deepEqual([by('order')[0].parent_id, by('payable')[0].parent_id, by('invoice')[0].parent_id], [OID, PID, IID]);
  assert.equal(by('order')[0].file_name, 'PO 77.pdf');
  assert.equal(by('payable')[0].kind, 'bill');
  assert.equal(by('invoice')[0].storage_path, D3.storagePath);
});
check('the files come back on the right record', () => {
  const rows = stateToRows(state({ orders: [order(OID, [D1]), order(OID2, [D4])], payables: [bill([D2])], invoices: [invoice([D3])] }), FARM);
  const y = rowsToState(rows).years[2026];
  assert.deepEqual(y.orders.find((o) => o.id === OID).documents, [D1]);
  assert.deepEqual(y.orders.find((o) => o.id === OID2).documents, [D4]);
  assert.deepEqual(y.payables[0].documents, [D2]);
  assert.deepEqual(y.invoices[0].documents, [D3]);
});
check('a record with nothing attached sends no rows and comes back without a documents list', () => {
  const rows = stateToRows(state({ orders: [order(OID)], payables: [bill()], invoices: [invoice()] }), FARM);
  assert.equal(rows.record_documents.length, 0);
  const y = rowsToState(rows).years[2026];
  assert.ok(!('documents' in y.orders[0]) && !('documents' in y.payables[0]) && !('documents' in y.invoices[0]));
});
check('an upload that did not finish (no path) is not sent', () => {
  const rows = stateToRows(state({ orders: [order(OID, [{ ...D1, storagePath: '' }])] }), FARM);
  assert.equal(rows.record_documents.length, 0);
});

console.log('\n=== which rows a device owes ===');

const allRows = () => stateToRows(state({ orders: [order(OID, [D1]), order(OID2, [D4])], payables: [bill([D2])], invoices: [invoice([D3])] }), FARM);
const ids = (r) => r.record_documents.map((x) => x.id);

check('editing an order sends its files and no one else\'s', () => {
  const rows = allRows();
  assert.deepEqual(ids(selectDirtyRows(rows, state({}), [{ kind: 'order', id: OID }])), [D1.id]);
});
check('editing a bill or an invoice sends that one\'s files', () => {
  const rows = allRows();
  assert.deepEqual(ids(selectDirtyRows(rows, state({}), [{ kind: 'payable', id: PID }])), [D2.id]);
  assert.deepEqual(ids(selectDirtyRows(rows, state({}), [{ kind: 'invoice', id: IID }])), [D3.id]);
});
check('a record nobody edited sends no files', () => {
  assert.deepEqual(ids(selectDirtyRows(allRows(), state({}), [{ kind: 'field', id: 'x' }])), []);
});

console.log('\n=== who may write them, and the database side ===');

check('the push writes them last, and for the roles that can write the record they belong to', () => {
  const sync = read('docs/js/sync.js');
  assert.match(sync, /'payables',\n  'record_documents'/);
  assert.match(sync, /manager: \[[^\]]*'record_documents'/);
  assert.match(sync, /bookkeeper: \[[^\]]*'record_documents'/);
  assert.ok(!/farm_worker: \[[^\]]*'record_documents'/.test(sync) && !/driver: \[[^\]]*'record_documents'/.test(sync));
});
check('they are read back when the farm loads', () => {
  assert.match(read('docs/js/hydrate.js'), /'freight_orders', 'input_stock', 'record_documents',/);
});
check('owners, managers and bookkeepers see and attach files to orders, invoices and bills; nobody else does', () => {
  const sql = read('supabase/migrations/20261114190000_record_documents.sql');
  const policies = sql.split('create or replace function soft_delete_row')[0];
  assert.ok(policies.split("app_role(farm_id) in ('owner', 'manager', 'bookkeeper')").length - 1 >= 4, 'select, insert and update');
  assert.ok(!policies.includes("in ('owner', 'bookkeeper')"), 'no policy leaves the manager out');
  assert.ok(sql.includes("check (parent_type in ('order', 'invoice', 'payable'))"));
  assert.match(sql, /'sale_documents', 'record_documents', 'movements'/, 'the delete function knows the table');
});
check('managers see and record invoices and bills as well', () => {
  const sql = read('supabase/migrations/20261114200000_manager_sees_money.sql');
  for (const t of ['invoices', 'payables']) {
    const flat = sql.replace(/\s+/g, ' ');
    assert.ok(flat.includes(`create policy ${t}_select on ${t} for select using (app_role(farm_id) in ('owner', 'manager', 'bookkeeper')`), t);
    assert.ok(flat.includes(`create policy ${t}_insert on ${t} for insert with check (app_role(farm_id) in ('owner', 'manager', 'bookkeeper')`), t);
  }
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('managers see invoices and bills'));
  assert.ok(read('docs/js/views/sales.js').includes("['owner', 'manager', 'bookkeeper'].includes(db.getRole()) ? `<button type=\"button\" class=\"btn secondary\" id=\"open-money\""));
});
check('the kinds the app offers are kinds the table accepts', () => {
  const sql = read('supabase/migrations/20261114190000_record_documents.sql');
  const allowed = sql.match(/kind\s+text not null default 'other'\s+check \(kind in \(([^)]*)\)\)/)[1].match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1));
  const src = read('docs/js/documents.js');
  const block = src.slice(src.indexOf('RECORD_DOCUMENT_KINDS'), src.indexOf('export function kindLabel'));
  const offered = [...block.matchAll(/value: '([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(offered.length >= 6);
  assert.deepEqual(offered.filter((k) => !allowed.includes(k)), []);
});
check('the paste file carries the migration', () => {
  assert.match(read('supabase/paste-into-sql-editor.sql'), /create table if not exists record_documents/);
});
check('the order, bill and invoice sheets all have the attach control, and a removed file is deleted for good', () => {
  for (const f of ['orders', 'payables', 'invoice']) assert.match(read(`docs/js/views/${f}.js`), /attachmentsHtml\(/, f);
  const att = read('docs/js/views/attachments.js');
  assert.match(att, /db\.deleteDocument\('record_documents'/);
  assert.match(read('docs/js/views/sales.js'), /db\.deleteDocument\('sale_documents'/);
});

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`);
process.exit(failures ? 1 : 0);
