// Run with:
//   node tests/driversign.test.mjs
//
// The driver's signature on a load: drawn on the phone, kept with the load with a print of what the load said, flagged when the load
// is changed afterwards (never locked), on the load ticket, a column on the load report, saved in its own optional column.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';
import { loadPrint, cleanDriverSignature, signLoad, signState, signedWhen, SIGN_WORDS } from '../docs/js/driversign.js';
import { loadReportRows, reportColumns, buildLoadReportPdf, buildLoadTicketPdf } from '../docs/js/loadreport.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const text = (bytes) => Buffer.from(bytes).toString('latin1');

const STROKES = [[[0.1, 0.5], [0.3, 0.2], [0.5, 0.8], [0.9, 0.4]], [[0.2, 0.9]]];
const AT = '2026-11-16T03:35:00.000Z';
const load = { id: '11111111-1111-1111-1111-111111111111', ticketNo: 1, date: '2026-11-16', commodityId: 'w', tons: 30.42, grossWeight: 48.2, tareWeight: 17.78, truckRego: 'ABC123', driver: 'Sam Reid', weightStatus: 'final', froms: [{ type: 'silo', id: 's1', tons: 30.42 }], tos: [{ type: 'sale', id: 'k1', tons: 30.42 }] };

check('the print of a load changes with what the driver signs for, and not with noise', () => {
  const p = loadPrint(load);
  assert.equal(p, loadPrint({ ...load, truckRego: ' abc123 ', tons: 30.4200001, notes: 'a note', grade: 'APW1', loadTime: '14:35' }), 'case, spaces, rounding, notes, grade and time do not count');
  for (const change of [{ tons: 31 }, { truckRego: 'XYZ999' }, { date: '2026-11-17' }, { commodityId: 'b' }, { grossWeight: 49 }, { driver: 'Joe' },
    { froms: [{ type: 'silo', id: 's2', tons: 30.42 }] }, { tos: [{ type: 'silo', id: 's9', tons: 30.42 }] }]) {
    assert.notEqual(p, loadPrint({ ...load, ...change }), JSON.stringify(change));
  }
});

check('a signature is kept only when something was drawn, and says when and by whom', () => {
  assert.equal(cleanDriverSignature(null), null);
  assert.equal(cleanDriverSignature({ strokes: [], name: 'Sam' }), null);
  assert.equal(cleanDriverSignature({ strokes: 'x' }), null);
  const sig = signLoad({ strokes: STROKES, name: '  Sam Reid ', at: AT }, load);
  assert.equal(sig.name, 'Sam Reid');
  assert.equal(sig.at, AT);
  assert.equal(sig.print, loadPrint(load));
  assert.equal(sig.strokes.length, 2);
  assert.match(signedWhen(sig), /^\d\d-\d\d-2026 \d\d:\d\d$/);
  assert.equal(signedWhen(null), '');
  assert.equal(cleanDriverSignature({ strokes: STROKES, at: 'not a date' }).at, '');
});

check('a load is not signed, signed, or changed since it was signed', () => {
  assert.equal(signState(load), 'none');
  const signed = { ...load, driverSignature: signLoad({ strokes: STROKES, name: 'Sam', at: AT }, load) };
  assert.equal(signState(signed), 'signed');
  assert.equal(signState({ ...signed, notes: 'a note typed later' }), 'signed', 'a note is not what was signed for');
  assert.equal(signState({ ...signed, tons: 29 }), 'changed');
  assert.equal(signState({ ...signed, froms: [{ type: 'silo', id: 'other', tons: 30.42 }] }), 'changed');
  const again = { ...signed, tons: 29 };
  again.driverSignature = signLoad({ strokes: STROKES, name: 'Sam', at: AT }, again);
  assert.equal(signState(again), 'signed', 'signing again clears the flag');
});

const FARM = '99999999-9999-9999-9999-999999999999';
const stateWith = (m) => ({ currentYear: '2026', nextMovementNo: 5, businessDetails: {}, years: { 2026: { commodities: [], fields: [], sales: [], invoices: [], overheads: {}, storages: [], movements: [m] } } });

check('the signature is saved with the load, only once there is one, and comes back', () => {
  assert.ok(!('driver_signature' in stateToRows(stateWith(load), FARM).movements[0]), 'unsigned sends no column, so it saves before the database has it');
  const sig = signLoad({ strokes: STROKES, name: 'Sam', at: AT }, load);
  const rows = stateToRows(stateWith({ ...load, driverSignature: sig }), FARM);
  assert.deepEqual(rows.movements[0].driver_signature, sig);
  const back = rowsToState(rows).years['2026'].movements[0];
  assert.deepEqual(back.driverSignature, sig);
  const removed = stateToRows(stateWith({ ...load, driverSignature: null, __hasDriverSig: true }), FARM);
  assert.equal(removed.movements[0].driver_signature, null, 'taking it off reaches the server');
});

check('the column is in its own migration and in the paste-in file', () => {
  assert.ok(read('supabase/migrations/20261215000000_movement_driver_signature.sql').includes('add column if not exists driver_signature jsonb'));
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('add column if not exists driver_signature jsonb'));
});

const ctx = { fields: [], storages: [{ id: 's1', name: 'Silo 3' }], sales: [{ id: 'k1', buyer: 'Graincorp', contractNo: 'C-77' }], commodities: [{ id: 'w', name: 'Wheat' }] };
const signedLoad = { ...load, driverSignature: signLoad({ strokes: STROKES, name: 'Sam Reid', at: AT }, load) };

check('the load report and the load list say nothing about signatures; only the ticket carries it', () => {
  const rows = loadReportRows([signedLoad, { ...load, id: 'b', ticketNo: 2 }, { ...signedLoad, id: 'c', ticketNo: 3, tons: 20 }], ctx);
  assert.deepEqual(rows.map((r) => r.signed), ['Yes', '', 'Changed'], 'the row still knows, for the ticket');
  assert.ok(!reportColumns({ showCompany: true, showDestination: true, showGrade: true }).some((c) => c.key === 'signed'));
  assert.ok(!text(buildLoadReportPdf(rows, {})).includes('(Signed)'));
  assert.ok(!read('docs/js/views/movements.js').includes("'Signed, changed'"), 'no badge on the load list');
});

check('the load ticket shows the signature, the name, the words and when, and says if the load changed', () => {
  const [row] = loadReportRows([signedLoad], ctx);
  const s = text(buildLoadTicketPdf(row, {}));
  for (const w of ['(DRIVER SIGNED)', '(Sam Reid)', `(${SIGN_WORDS})`, `(${row.signedAt})`]) assert.ok(s.includes(w), `missing ${w}`);
  assert.ok(!s.includes('changed after it was signed'));
  const [changed] = loadReportRows([{ ...signedLoad, tons: 20 }], ctx);
  assert.ok(text(buildLoadTicketPdf(changed, {})).includes('The load was changed after it was signed'));
  const [plain] = loadReportRows([load], ctx);
  assert.ok(!text(buildLoadTicketPdf(plain, {})).includes('DRIVER SIGNED'));
  const [tested] = loadReportRows([{ ...signedLoad, notes: 'a note', proteinPct: 11.2, moisturePct: 11 }], ctx);
  assert.ok(text(buildLoadTicketPdf(tested, {})).includes('(DRIVER SIGNED)'));
});

check('the load form has the section, signs last with the print of the saved load, can sign again or remove it, and the slip carries it', () => {
  const mv = read('docs/js/views/movements.js');
  assert.ok(mv.includes('id="ds-fold"') && mv.includes('id="ds-body"') && mv.includes('Driver signs'));
  assert.ok(mv.includes('...(sigPending ? { driverSignature: cleanDriverSignature(sigPending) } : sigRemoved ? { driverSignature: null } : {})'));
  assert.ok(mv.includes('live.driverSignature = sigPending ? signLoad(sigPending, live)'));
  assert.ok(mv.includes('id="ds-again"') && mv.includes('id="ds-remove"'));
  const st = read('docs/js/storage.js');
  assert.ok(st.includes('if (rec.driverSignature) rec.__hasDriverSig = true;'));
  assert.equal(st.split('stampSignature(').length - 1, 3, 'defined, and used when a load is changed and when one is made');
  assert.ok(st.includes('m.driverSignature = signLoad(m.driverSignature, m)'));
  assert.ok(read('docs/js/audit.js').includes("driver_signature: 'Driver signature'"));
  assert.ok(read('docs/js/views/settingsexport.js').includes("label: 'Driver signed'"));
});

check('the pad is shared: the drawing part is its own function, used by the saved-signature pad as well', () => {
  const sp = read('docs/js/views/signaturepad.js');
  assert.ok(sp.includes('export function wireDrawing(') && sp.includes('export const padBoxHtml'));
  assert.ok(sp.includes('const draw = wireDrawing(container);') && sp.includes('cleanStrokes(draw.strokes())'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
