import assert from 'node:assert/strict';
import fs from 'node:fs';
import { traceReportRows, traceTotals, traceSummary, traceBySale, sourceText, partsText, traceCsvRows, TRACE_CSV_COLUMNS, buildTraceReportPdf } from '../docs/js/tracereport.js?v=450';
import { traceParts, traceText } from '../docs/js/trace.js?v=450';

let failed = 0;
function check(name, fn) { try { fn(); console.log('  PASS  ' + name); } catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + e.message); } }

const data = {
  fields: [{ id: 'fA', name: 'North', property: '' }, { id: 'fB', name: 'South', property: 'Aralu' }],
  storages: [{ id: 's1', name: 'Silo 1', kind: 'silo', openingStock: 0 }],
  sales: [{ id: 'k1', buyer: 'Graincorp', contractNo: '12', commodityId: 'w' }, { id: 'k2', buyer: 'Other', commodityId: 'b' }],
  commodities: [{ id: 'w', name: 'Wheat' }, { id: 'b', name: 'Barley' }],
  movements: [
    { id: 'm1', date: '2026-11-01', ticketNo: 1, commodityId: 'w', tons: 30, froms: [{ type: 'field', id: 'fA', tons: 30 }], tos: [{ type: 'silo', id: 's1', tons: 30 }] },
    { id: 'm2', date: '2026-11-02', ticketNo: 2, commodityId: 'w', tons: 10, froms: [{ type: 'field', id: 'fB', tons: 10 }], tos: [{ type: 'silo', id: 's1', tons: 10 }] },
    { id: 'm3', date: '2026-11-05', ticketNo: 3, commodityId: 'w', tons: 40, froms: [{ type: 'silo', id: 's1', tons: 40 }], tos: [{ type: 'sale', id: 'k1', tons: 40 }] },
    { id: 'm4', date: '2026-11-06', ticketNo: 4, commodityId: 'b', tons: 20, froms: [{ type: 'field', id: 'fB', tons: 20 }], tos: [{ type: 'sale', id: 'k2', tons: 20 }] },
  ],
};

check('loads to contracts are traced to their paddocks, through the silo they passed through', () => {
  const rows = traceReportRows(data, {});
  assert.deepEqual(rows.map((r) => r.id), ['m3', 'm4']);
  assert.deepEqual(rows[0].parts, [{ name: 'North', tons: 30 }, { name: 'Aralu South', tons: 10 }]);
  assert.equal(partsText(rows[0].parts), 'North 30.00 t; Aralu South 10.00 t');
  assert.equal(rows[0].goingTo, 'Graincorp #12');
  assert.equal(rows[0].commodity, 'Wheat');
});

check('a contract, a commodity, dates and every load each narrow the list', () => {
  assert.deepEqual(traceReportRows(data, { scope: 'k2' }).map((r) => r.id), ['m4']);
  assert.deepEqual(traceReportRows(data, { commodityId: 'b' }).map((r) => r.id), ['m4']);
  assert.deepEqual(traceReportRows(data, { from: '2026-11-06' }).map((r) => r.id), ['m4']);
  assert.deepEqual(traceReportRows(data, { scope: 'all' }).map((r) => r.id), ['m1', 'm2', 'm3', 'm4']);
});

check('the paddocks add up across the loads, with their share', () => {
  const rows = traceReportRows(data, {});
  assert.deepEqual(traceTotals(rows), { loads: 2, tons: 60 });
  const s = traceSummary(rows);
  assert.equal(s[0].name, 'North');
  assert.equal(s[0].tons, 30);
  assert.equal(s.length, 2);
  assert.equal(s[1].tons, 30);   // South: 10 t through the silo and 20 t straight to the other contract
  assert.ok(Math.abs(s.reduce((a, x) => a + x.share, 0) - 1) < 1e-9);
});

check('a load with no source recorded says so, and the CSV words are unchanged', () => {
  assert.equal(partsText([]), 'Not recorded');
  const from = new Map([['field:fA', 5]]);
  assert.equal(traceText(from, data), 'North 5 t');
  assert.deepEqual(traceParts(from, data), [{ name: 'North', tons: 5 }]);
});

check('by sale: each contract has its loads, its tonnes and its paddocks; a load to two contracts is shared by the tonnes to each', () => {
  const g = traceBySale(traceReportRows(data, {}));
  assert.deepEqual(g.map((x) => [x.name, x.loads, x.tons]), [['Graincorp #12', 1, 40], ['Other', 1, 20]]);
  assert.deepEqual(g[0].summary.map((s) => [s.name, s.tons]), [['North', 30], ['Aralu South', 10]]);
  const split = { ...data, movements: [...data.movements, { id: 'm5', date: '2026-11-07', ticketNo: 5, commodityId: 'w', tons: 10, froms: [{ type: 'field', id: 'fA', tons: 10 }], tos: [{ type: 'sale', id: 'k1', tons: 6 }, { type: 'sale', id: 'k2', tons: 4 }] }] };
  const s = traceBySale(traceReportRows(split, {}));
  assert.equal(s.find((x) => x.name === 'Graincorp #12').tons, 46);
  assert.equal(s.find((x) => x.name === 'Other').tons, 24);
  assert.equal(s.find((x) => x.name === 'Other').summary.find((p) => p.name === 'North').tons, 4);
  assert.equal(buildTraceReportPdf(traceReportRows(split, {}), { by: 'sale' }).length > 2000, true);
});

check('with the silo in the chain, a load says which silo and what was in it, and a mixed silo is called a blend', () => {
  const row = traceReportRows(data, {})[0];
  assert.equal(row.legs.length, 1);
  assert.equal(row.legs[0].name, 'Silo 1');
  assert.equal(sourceText(row, true), 'Silo 1 40.00 t: North 30.00 t; Aralu South 10.00 t (blend of 2)');
  assert.equal(sourceText(row, false), partsText(row.parts));
  const straight = traceReportRows(data, {})[1];
  assert.equal(sourceText(straight, true), 'Aralu South 20.00 t');   // a paddock straight onto a truck has no silo to show
  assert.ok(buildTraceReportPdf([row], { showStore: true }).length > 1500);
});

check('the Excel table has a line for each place a load came from, with the silo and the share of the load', () => {
  const rows = traceReportRows(data, {});
  const csv = traceCsvRows(rows, 'load');
  assert.deepEqual(csv.filter((r) => r.ticket === 3).map((r) => [r.silo, r.source, r.tons]), [['Silo 1', 'North', 30], ['Silo 1', 'Aralu South', 10]]);
  assert.deepEqual(csv.filter((r) => r.ticket === 4).map((r) => [r.silo, r.source, r.tons]), [['', 'Aralu South', 20]]);
  assert.equal(csv[0].share, 0.75);
  assert.equal(TRACE_CSV_COLUMNS.length, 10);
  assert.equal(TRACE_CSV_COLUMNS[8].get(csv[0]), '30.00');
  const bySale = traceCsvRows(rows, 'sale');
  assert.deepEqual([...new Set(bySale.map((r) => r.contract))], ['Graincorp #12', 'Other']);
});

check('the PDF is made, with several pages for many loads', () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ id: 'x' + i, date: '2026-11-01', ticketNo: i, commodity: 'Wheat', goingTo: 'Buyer', truck: '', tons: 30, parts: [{ name: 'North', tons: 20 }, { name: 'South', tons: 10 }] }));
  const bytes = buildTraceReportPdf(many, { business: 'Farm', scopeLabel: 'Loads to contracts' });
  assert.ok(bytes.length > 2000);
  assert.ok(buildTraceReportPdf([], {}).length > 500);
});

check('it is a Reports tile for people who see loads, and the sheet sends or downloads', () => {
  const hub = fs.readFileSync('docs/js/reportshub.js', 'utf8');
  assert.ok(hub.includes("tile('trace', 'Traceability', 'sheet')") && hub.includes('trace: '));
  assert.ok(fs.readFileSync('docs/js/views/reports.js', 'utf8').includes('trace: () => openTraceSheet()'));
  const v = fs.readFileSync('docs/js/views/tracereport.js', 'utf8');
  assert.ok(v.includes('id="tr-send"') && v.includes('id="tr-download"') && v.includes('data-by="sale"') && v.includes('id="tr-store"') && v.includes('id="tr-csv"'));
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
