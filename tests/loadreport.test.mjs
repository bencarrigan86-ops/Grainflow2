// Run with:
//   node tests/loadreport.test.mjs
//
// The load report: which loads are on it, the columns (and turning the origin off), the PDF, the time on a load and
// that it is saved with the farm.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadReportRows, loadReportTotals, reportColumns, buildLoadReportPdf, buildLoadTicketPdf, siteOf, cleanTime, nowTime, rangeText, clipText, endName } from '../docs/js/loadreport.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const ctx = {
  fields: [{ id: 'f1', name: 'River Block' }],
  storages: [{ id: 's1', name: 'Silo 3' }],
  sales: [{ id: 'k1', buyer: 'Graincorp', contractNo: 'C-77', location: 'Newcastle terminal' }, { id: 'k2', buyer: 'Louis Dreyfus' }],
  commodities: [{ id: 'w', name: 'Wheat' }, { id: 'b', name: 'Barley' }],
};
const mv = (o) => ({ grossWeight: o.grossWeight, tareWeight: o.tareWeight, id: o.id, ticketNo: o.ticketNo, date: o.date, loadTime: o.loadTime, commodityId: o.commodityId || 'w', truckRego: o.truckRego || 'ABC123', driver: o.driver || 'Sam', tons: o.tons ?? 30, weightStatus: o.weightStatus || 'estimate',
  froms: o.froms || [{ type: 'silo', id: 's1' }], tos: o.tos || [{ type: 'sale', id: 'k1' }] });
const moves = [
  mv({ id: 'a', ticketNo: 3, date: '2026-11-15', loadTime: '14:30' }),
  mv({ id: 'b', ticketNo: 2, date: '2026-11-15', loadTime: '08:05', grossWeight: 45, tareWeight: 15, froms: [{ type: 'field', id: 'f1' }] }),
  mv({ id: 'c', ticketNo: 1, date: '2026-11-14', tons: 25, weightStatus: 'final', tos: [{ type: 'sale', id: 'k2' }] }),
  mv({ id: 'd', ticketNo: 4, date: '2026-11-16', commodityId: 'b', tos: [{ type: 'silo', id: 's1' }] }),
];

console.log('\n=== which loads ===');
check('oldest first: by date, then time, then ticket number', () => {
  assert.deepEqual(loadReportRows(moves, ctx).map((r) => r.id), ['c', 'b', 'a', 'd']);
});
check('a date range is inclusive at both ends', () => {
  assert.deepEqual(loadReportRows(moves, ctx, { from: '2026-11-15', to: '2026-11-15' }).map((r) => r.id), ['b', 'a']);
  assert.deepEqual(loadReportRows(moves, ctx, { from: '2026-11-15' }).map((r) => r.id), ['b', 'a', 'd']);
});
check('narrowed to a commodity, or to the loads going to one contract', () => {
  assert.deepEqual(loadReportRows(moves, ctx, { commodityId: 'b' }).map((r) => r.id), ['d']);
  assert.deepEqual(loadReportRows(moves, ctx, { saleId: 'k2' }).map((r) => r.id), ['c']);
});
check('each line carries the details asked for', () => {
  const r = loadReportRows(moves, ctx).find((x) => x.id === 'a');
  assert.equal(r.date, '2026-11-15'); assert.equal(r.time, '14:30'); assert.equal(r.truck, 'ABC123'); assert.equal(r.driver, 'Sam');
  assert.equal(r.goingTo, 'Graincorp #C-77'); assert.equal(r.destination, 'Newcastle terminal');
  assert.equal(loadReportRows(moves, ctx).find((x) => x.id === 'c').destination, 'Louis Dreyfus', 'a contract with no delivery site falls back to its buyer');
  assert.equal(loadReportRows(moves, ctx).find((x) => x.id === 'd').destination, '', 'a load into a silo has none');
  assert.equal(siteOf({ location: 'Port', pricingPoint: 'FIS', buyer: 'B' }), 'Port');
  assert.equal(siteOf({ pricingPoint: 'Newcastle FIS', buyer: 'B' }), 'Newcastle FIS');
  assert.equal(siteOf(undefined), ''); assert.equal(r.tons, 30); assert.equal(r.ticketNo, 3); assert.equal(r.from, 'Silo 3'); assert.equal(r.commodity, 'Wheat');
  assert.equal(loadReportRows(moves, ctx).find((x) => x.id === 'b').from, 'River Block', 'a paddock or a storage');
  assert.equal(loadReportRows(moves, ctx).find((x) => x.id === 'c').final, true);
});
check('totals add up the loads and tonnes', () => {
  assert.deepEqual(loadReportTotals(loadReportRows(moves, ctx)), { loads: 4, tons: 115, gross: 45, tare: 15 });
});
check('names: a contract with no number, in transit, unknown things', () => {
  assert.equal(endName({ type: 'sale', id: 'k2' }, ctx), 'Louis Dreyfus');
  assert.equal(endName({ type: 'silo', id: '__transit__' }, ctx), 'In transit');
  assert.equal(endName({ type: 'field', id: 'nope' }, ctx), 'Unknown paddock');
});
check('times are kept to 24 hour text, and rubbish is dropped', () => {
  assert.equal(cleanTime('7:05'), '07:05'); assert.equal(cleanTime('14:30:10'), '14:30');
  assert.equal(cleanTime('25:00'), ''); assert.equal(cleanTime(''), ''); assert.equal(cleanTime(undefined), '');
  assert.equal(nowTime(new Date(2026, 10, 15, 9, 4)), '09:04');
});
check('the date line', () => {
  assert.equal(rangeText('2026-11-15', '2026-11-15'), '15-11-2026');
  assert.equal(rangeText('2026-11-01', '2026-11-15'), '01-11-2026 to 15-11-2026');
});

console.log('\n=== the PDF ===');
check('the origin column can be turned off, and the contract column takes its room', () => {
  const on = reportColumns({ showOrigin: true }); const off = reportColumns({ showOrigin: false });
  assert.ok(on.some((c) => c.key === 'from') && !off.some((c) => c.key === 'from'));
  const w = (cs) => cs.find((c) => c.key === 'goingTo').w;
  assert.ok(w(off) > w(on));
  for (const cs of [on, off]) { const last = cs[cs.length - 1]; assert.ok(Math.abs(last.x + last.w - (841.89 - 36)) < 0.01, 'fills the page width'); }
});
check('long text is cut to fit its column', () => {
  assert.ok(clipText('A very long contract name indeed', 60).endsWith('...'));
  assert.equal(clipText('Short', 60), 'Short');
});
const text = (bytes) => Buffer.from(bytes).toString('latin1');
check('a PDF is made with the loads, the totals and the origin when it is on', () => {
  const rows = loadReportRows(moves, ctx);
  const pdf = text(buildLoadReportPdf(rows, { business: 'Carrigan Farming', from: '2026-11-14', to: '2026-11-16', showOrigin: true }));
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.ok(pdf.includes('(LOAD REPORT)') && pdf.includes('(4 loads, 115.00 t)') && pdf.includes('(Carrigan Farming'));
  assert.ok(pdf.includes('(14:30)') && pdf.includes('(ABC123)') && pdf.includes('(Graincorp #C-77)') && pdf.includes('(#3)'));
  assert.ok(pdf.includes('(Gross \\(t\\))') && pdf.includes('(Tare \\(t\\))') && pdf.includes('(Net \\(t\\))') && pdf.includes('(45.00)') && pdf.includes('(15.00)'), 'gross, tare and net');
  assert.ok(pdf.includes('(25.00 final)') && pdf.includes('(30.00 est)'));
  assert.ok(!text(buildLoadReportPdf(rows.filter((r) => r.gross === null && r.tare === null), {})).includes('(Gross'), 'no gross or tare columns when none was recorded');
  assert.ok(pdf.includes('(From)') && pdf.includes('(River Block)'));
  assert.ok(pdf.includes('(Destination)') && pdf.includes('(Newcastle terminal)'));
  assert.ok(!text(buildLoadReportPdf(rows.filter((r) => !r.destination), {})).includes('(Destination)'), 'no column when no load has one');
  assert.ok(pdf.includes('/MediaBox [0 0 841.89 595.28]'), 'landscape A4');
});
check('the destination can be turned off on the report and on the slip', () => {
  const rows = loadReportRows(moves, ctx);
  const off = text(buildLoadReportPdf(rows, { showDestination: false }));
  assert.ok(!off.includes('(Destination)') && !off.includes('(Newcastle terminal)'));
  const slip = text(buildLoadTicketPdf(rows.find((r) => r.id === 'b'), { showDestination: false }));
  assert.ok(!slip.includes('(DESTINATION)') && !slip.includes('(Newcastle terminal)'));
});
check('with the origin off, where a load came from is not on the report', () => {
  const pdf = text(buildLoadReportPdf(loadReportRows(moves, ctx), { showOrigin: false }));
  assert.ok(!pdf.includes('(From)') && !pdf.includes('(River Block)'));
});
check('many loads run over to more pages, each with the heading', () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ id: `x${i}`, date: '2026-11-15', time: '', ticketNo: i + 1, truck: 'T', driver: 'D', commodity: 'Wheat', goingTo: 'Buyer', from: 'Silo', tons: 30, final: false }));
  const pdf = text(buildLoadReportPdf(many, {}));
  const pages = (pdf.match(/\/Type \/Page /g) || []).length;
  assert.ok(pages >= 3, `pages: ${pages}`);
  assert.equal((pdf.match(/\(LOAD REPORT\)/g) || []).length, pages);
});
check('no loads still makes a page that says so', () => {
  assert.ok(text(buildLoadReportPdf([], {})).includes('(No loads match.)'));
});

console.log('\n=== one load ===');
check('a single load makes a slip with the same details, and the origin can be left off', () => {
  const row = loadReportRows(moves, ctx).find((r) => r.id === 'b');
  const on = text(buildLoadTicketPdf(row, { business: 'Carrigan Farming', showOrigin: true }));
  assert.ok(on.includes('(LOAD TICKET)') && on.includes('(#2)') && on.includes('(08:05)') && on.includes('(ABC123)') && on.includes('(Sam)') && on.includes('(Graincorp #C-77)') && on.includes('(45.00 t)') && on.includes('(15.00 t)') && on.includes('(30.00 t)') && on.includes('(GROSS)') && on.includes('(TARE)') && on.includes('(NET)') && on.includes('(estimate)') && on.includes('(DESTINATION)') && on.includes('(Newcastle terminal)'));
  assert.ok(on.includes('(FROM)') && on.includes('(River Block)'));
  const off = text(buildLoadTicketPdf(row, { showOrigin: false }));
  assert.ok(!off.includes('(FROM)') && !off.includes('(River Block)') && off.includes('(GOING TO)'));
  assert.ok(on.includes('/MediaBox [0 0 595.28 841.89]'), 'portrait A4');
});

check('grade and what was tested on the load are on the slip and the report, and the results can be hidden', () => {
  const tested = { ...moves[1], grade: 'APH1', proteinPct: 11.8, moisturePct: 11.2, testWeightKgHl: 79.5, fallingNumber: 410, retentionPct: 82.4 };
  const rows = loadReportRows([tested, moves[0]], ctx);
  const r = rows.find((x) => x.id === 'b');
  assert.equal(r.grade, 'APH1');
  assert.deepEqual(r.quality.map((q) => `${q.label} ${q.text}`), ['Protein 11.8%', 'Moisture 11.2%', 'Test weight 79.5 kg/hL', 'Falling no. 410 s', 'Retention 82.4%']);
  assert.deepEqual(rows.find((x) => x.id === 'a').quality, [], 'nothing for a load not tested');
  const slip = text(buildLoadTicketPdf(r, {}));
  assert.ok(slip.includes('(GRADE)') && slip.includes('(APH1)') && slip.includes('(QUALITY TESTED ON THIS LOAD)') && slip.includes('(11.8%)') && slip.includes('(79.5 kg/hL)') && slip.includes('(82.4%)'));
  const hidden = text(buildLoadTicketPdf(r, { showQuality: false }));
  assert.ok(hidden.includes('(APH1)') && !hidden.includes('QUALITY TESTED') && !hidden.includes('(11.8%)'), 'grade stays, results go');
  assert.ok(!text(buildLoadTicketPdf(rows.find((x) => x.id === 'a'), {})).includes('QUALITY TESTED'), 'no box when nothing was tested');
  const rep = text(buildLoadReportPdf(rows, {}));
  assert.ok(rep.includes('(Grade)') && rep.includes('Tested:') && rep.includes('Protein 11.8%'));
  const repHidden = text(buildLoadReportPdf(rows, { showQuality: false }));
  assert.ok(repHidden.includes('(Grade)') && !repHidden.includes('Tested:'));
  const noGrade = text(buildLoadReportPdf(loadReportRows([moves[0]], ctx), {}));
  assert.ok(!noGrade.includes('(Grade)'), 'no grade column when no load has one');
  const m2 = read('docs/js/views/movements.js'); const v = read('docs/js/views/loadreport.js');
  assert.ok(m2.includes('id="tk-quality"') && m2.includes('saveQuality(e.target.checked)') && v.includes('id="lr-quality"') && v.includes('showQuality: d.showQuality'), 'a tick for the results in both places');
});
check('the slip and the report carry the trading name and the NGR', () => {
  const row = loadReportRows(moves, ctx).find((r) => r.id === 'b');
  const slip = text(buildLoadTicketPdf(row, { business: 'Carrigan Farming Pty Ltd', ngr: '12345678' }));
  assert.ok(slip.includes('(Carrigan Farming Pty Ltd)') && slip.includes('(NGR 12345678)'));
  assert.ok(!text(buildLoadTicketPdf(row, { business: 'Carrigan Farming Pty Ltd' })).includes('(NGR'), 'no NGR line when none is set');
  const rep = text(buildLoadReportPdf(loadReportRows(moves, ctx), { business: 'Carrigan Farming Pty Ltd', ngr: '12345678' }));
  assert.ok(rep.includes('NGR 12345678'));
  const v = read('docs/js/views/loadreport.js');
  assert.ok(v.includes("ngr: business.ngr || ''"), 'taken from the business details');
});
check('the slip has a comments box with the load\'s notes, and it can be turned off', () => {
  const row = { ...loadReportRows(moves, ctx).find((r) => r.id === 'b'), notes: 'Call the weighbridge before arriving' };
  const on = text(buildLoadTicketPdf(row, { showComments: true }));
  assert.ok(on.includes('(COMMENTS)') && on.includes('(Call the weighbridge before arriving)'));
  assert.ok(text(buildLoadTicketPdf({ ...row, notes: '' }, {})).includes('(COMMENTS)'), 'room to write even with no notes');
  const off = text(buildLoadTicketPdf(row, { showComments: false }));
  assert.ok(!off.includes('(COMMENTS)') && !off.includes('weighbridge'));
  assert.equal(loadReportRows([{ ...moves[0], notes: ' hi ' }], ctx)[0].notes, 'hi');
});

check('a load from two places can list the tonnes from each, and that can be turned off', () => {
  const two = { ...moves[0], id: 'two', froms: [{ type: 'field', id: 'f1', tons: 12.5 }, { type: 'silo', id: 's1', tons: 17.5 }], tons: 30 };
  const row = loadReportRows([two], ctx)[0];
  assert.deepEqual(row.fromLegs, [{ name: 'River Block', tons: 12.5 }, { name: 'Silo 3', tons: 17.5 }]);
  const on = text(buildLoadTicketPdf(row, {}));
  assert.ok(on.includes('(River Block)') && on.includes('(12.50 t)') && on.includes('(Silo 3)') && on.includes('(17.50 t)'));
  const off = text(buildLoadTicketPdf(row, { showSplit: false }));
  assert.ok(off.includes('(River Block, Silo 3)') && !off.includes('(12.50 t)'));
  assert.ok(text(buildLoadTicketPdf(row, { showOrigin: false })).indexOf('(12.50 t)') < 0, 'nothing when the origin is hidden');
});
check('a load from one place has no split, and the tick is on the ticket sheet', () => {
  const one = loadReportRows([moves[0]], ctx)[0];
  assert.ok(text(buildLoadTicketPdf(one, {})).includes('(Silo 3)'));
  const m = read('docs/js/views/movements.js');
  assert.ok(m.includes('id="tk-split"') && m.includes("showSplit: root.querySelector('#tk-split').checked"));
  assert.ok(read('docs/js/views/loadreport.js').includes('export const readSplit'));
});

console.log('\n=== saved with the farm ===');
const FARM = '99999999-9999-9999-9999-999999999999';
const state = (movement) => ({
  currentYear: '2026', nextMovementNo: 2, businessDetails: {},
  years: { 2026: { commodities: [], fields: [], sales: [], invoices: [], overheads: {}, storages: [], movements: [{ id: '77777777-7777-7777-7777-777777777777', ticketNo: 1, froms: [], tos: [], tons: 10, ...movement }] } },
});
check('a destination typed on the load is what the report and slip show, in place of the contract\'s', () => {
  const rows = loadReportRows([{ ...moves[0], destination: ' Port Kembla ' }, moves[1]], ctx);
  assert.equal(rows.find((r) => r.id === 'a').destination, 'Port Kembla');
  assert.equal(rows.find((r) => r.id === 'b').destination, 'Newcastle terminal', 'none typed: the contract\'s delivery site');
  const siloLoad = loadReportRows([{ ...moves[3], destination: 'Home farm' }], ctx)[0];
  assert.equal(siloLoad.destination, 'Home farm', 'a load into a silo can have one too');
  assert.ok(text(buildLoadTicketPdf(rows.find((r) => r.id === 'a'), {})).includes('(Port Kembla)'));
});
check('the typed destination goes to the server and comes back; none sends no column', () => {
  const rows = stateToRows(state({ destination: 'Port Kembla' }), FARM);
  assert.equal(rows.movements[0].load_destination, 'Port Kembla');
  assert.equal(rowsToState(rows).years[2026].movements[0].destination, 'Port Kembla');
  assert.ok(!('load_destination' in stateToRows(state({}), FARM).movements[0]));
  assert.ok('load_destination' in stateToRows(state({ destination: '', __hasDestination: true }), FARM).movements[0], 'clearing it reaches the server');
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('add column if not exists load_destination text'));
  assert.ok(read('supabase/migrations/20261115130000_load_destination.sql').includes('load_destination text'));
  const m = read('docs/js/views/movements.js');
  assert.ok(m.includes("id: 'destination'") && m.includes("destination: getVal(root, 'destination')?.trim() || ''") && m.includes('dl-destinations'), 'a box on the load sheet to type it in');
  assert.ok(read('docs/js/storage.js').includes('if (rec.destination) rec.__hasDestination = true'));
});
check('the time goes to the server and comes back', () => {
  const rows = stateToRows(state({ loadTime: '14:30' }), FARM);
  assert.equal(rows.movements[0].load_time, '14:30');
  assert.equal(rowsToState(rows).years[2026].movements[0].loadTime, '14:30');
});
check('a load with no time sends no such column, so saving works before the database has it', () => {
  assert.ok(!('load_time' in stateToRows(state({}), FARM).movements[0]));
});
check('having had a time and cleared it still sends it, so the clearing reaches the server', () => {
  assert.ok('load_time' in stateToRows(state({ loadTime: '', __hasLoadTime: true }), FARM).movements[0]);
});
check('the column is in the paste-in file and the migration', () => {
  assert.ok(read('supabase/paste-into-sql-editor.sql').includes('add column if not exists load_time text'));
  assert.ok(read('supabase/migrations/20261115110000_load_time.sql').includes('add column if not exists load_time text'));
});
check('wired in: the Movement button, the time on the load sheet, and the remembered ticks', () => {
  const m = read('docs/js/views/movements.js');
  assert.ok(m.includes('id="dest-wrap"') && m.includes('Contract delivers to: <strong>'), 'the load sheet shows where the contract delivers');
  assert.ok(m.includes("from './loadreport.js") && m.includes('id="load-report"') && m.includes('openLoadReportSheet()'));
  assert.ok(m.includes("id: 'loadTime', type: 'time'") && m.includes("loadTime: getVal(root, 'loadTime') || ''"));
  assert.ok(read('docs/js/storage.js').includes('if (rec.loadTime) rec.__hasLoadTime = true'));
  const v = read('docs/js/views/loadreport.js');
  const m2 = read('docs/js/views/movements.js');
  assert.ok(m2.includes("grade: gradeCtl.read() || ''") && m2.includes("proteinPct: num('lq-protein')") && m2.includes("retentionPct: num('lq-ret')") && m2.includes("destination: getVal(root, 'destination')"), 'the slip is made from what is on the screen, saved or not');
  assert.ok(m2.includes('id="tk-send"') && m2.includes('sendLoadTicket(live') && m2.includes('saveOrigin(e.target.checked)'), 'a ticket can be sent from its own sheet');
  assert.ok(m2.includes('id="tk-comments"') && m2.includes('saveComments(e.target.checked)') && m2.includes("showComments: root.querySelector"), 'a tick for the comments');
  assert.ok(v.includes('id="lr-dest"') && m2.includes('id="tk-dest"') && m2.includes('saveDestination(e.target.checked)') && v.includes('showDestination: d.showDestination'), 'a tick for the destination in both places');
  assert.ok(v.includes('id="lr-origin"') && v.includes('showOrigin: d.showOrigin') && v.includes('sharePdf(bytes, fileName'));
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
