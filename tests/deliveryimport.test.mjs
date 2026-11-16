// Run with:
//   node tests/deliveryimport.test.mjs
//
// Outload numbers (the season, the person's digit and their count), and the receiving site's delivery file matched back to the
// loads: columns picked by the person or guessed from the headings, rows matched by the number and checked against the truck, the
// date and the commodity, the site's weight shared out over a load's legs, and the layout saved for next time.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seasonYY, normaliseOutloadNo, outloadParts, outloadSeasonOk, nextOutloadNo, duplicateOutloads } from '../docs/js/outloadno.js';
import {
  readTable, guessMapping, mappingProblems, extractRows, matchDeliveries, prorateLegs, deliveryPatch, looksRounded,
  makeFormat, saveFormat, removeFormat, findFormat, DELIVERY_FIELDS,
} from '../docs/js/deliveryimport.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// ---- the number ----
check('the season is two digits: from the label, or failing that the date', () => {
  assert.equal(seasonYY('2026'), '26');
  assert.equal(seasonYY('2025/26'), '25');
  assert.equal(seasonYY('Harvest', '2026-11-05'), '26');
  assert.equal(seasonYY('Harvest', ''), '');
});

check('a number is season, the person\'s digit and their count: 261001 is the first for person 1 in 2026', () => {
  assert.equal(nextOutloadNo({ series: 1, yy: '26', movements: [] }), '261001');
  assert.equal(nextOutloadNo({ series: 2, yy: '26', movements: [] }), '262001');
});

check('the next number is one more than the highest so far under the same season and digit, and no one else\'s', () => {
  const movements = [{ outloadNo: '261007' }, { outloadNo: '261003' }, { outloadNo: '262020' }, { outloadNo: '251050' }, { outloadNo: '' }, {}];
  assert.equal(nextOutloadNo({ series: 1, yy: '26', movements }), '261008');
  assert.equal(nextOutloadNo({ series: 2, yy: '26', movements }), '262021');
  assert.equal(nextOutloadNo({ series: 1, yy: '25', movements }), '251051');
  assert.equal(nextOutloadNo({ series: 3, yy: '26', movements }), '263001');
});

check('past 999 it grows (261000) and stays unambiguous, because the season is always two digits', () => {
  assert.equal(nextOutloadNo({ series: 1, yy: '26', movements: [{ outloadNo: '261999' }] }), '2611000');
  const p = outloadParts('2611000');
  assert.deepEqual([p.yy, p.series, p.seq], ['26', 1, 1000]);
});

check('no digit, or no season, means no number rather than a wrong one', () => {
  assert.equal(nextOutloadNo({ series: null, yy: '26' }), null);
  assert.equal(nextOutloadNo({ series: 0, yy: '26' }), null);
  assert.equal(nextOutloadNo({ series: 10, yy: '26' }), null);
  assert.equal(nextOutloadNo({ series: 1, yy: '' }), null);
});

check('a number typed or read from a file is digits only; its season can be checked', () => {
  assert.equal(normaliseOutloadNo(' 261 007 '), '261007');
  assert.equal(normaliseOutloadNo('26-1007'), '261007');
  assert.equal(normaliseOutloadNo(null), '');
  assert.equal(outloadParts('1234'), null);
  assert.equal(outloadSeasonOk('261007', '26'), true);
  assert.equal(outloadSeasonOk('251007', '26'), false);
});

check('a number on more than one load is found', () => {
  const dup = duplicateOutloads([{ id: 'a', outloadNo: '261001' }, { id: 'b', outloadNo: '261 001' }, { id: 'c', outloadNo: '261002' }, { id: 'd' }]);
  assert.deepEqual([...dup.keys()], ['261001']);
  assert.equal(dup.get('261001').length, 2);
});

// ---- the file ----
const GRAINCORP = [
  'Ticket #,Commodity,Grade,Net Tonnes (mt),Received Date,Site,NGR,Mass Breach (mt),SCRN/IMPU,Status,Season,Grower Name,Variety Code,Variety Name,Truck Rego,Paddock,MOGR,PRGR,TWT (kg/hl),RET,COIL,FALL (s),Croptimised,Transaction #,Date Traded',
  '6.298E+11,Wheat,APW1,69.67,4-Nov-25,Goondiwindi East,0015120110,,1.70%,Sold,25/26,GROWER,W528,LANCER,BNR659,251001,9.40%,11.00%,82,,,,,2006537740,15-Sep-26',
  '6.298E+11,Wheat,H2,72.05,4-Nov-25,Goondiwindi East,0015120110,,1.20%,Sold,25/26,GROWER,W528,LANCER,BNR659,251002,9.40%,11.20%,80.9,,,,Yes,2006537452,11-Sep-26',
  '6.298E+11,Wheat,APW1,0,27-Oct-25,Goondiwindi East,0015120110,,,Blocked,25/26,GROWER,W528,LANCER,LE9END,251003,,,,,,,,,',
  '6.298E+11,Barley,BAR1,73.36,27-Oct-25,Goondiwindi East,0015120110,,1.80%,Sold,25/26,GROWER,B089,NEO CL,LE9END,251004,10.50%,7.60%,69.2,95.80%,,,,2006467232,2-Mar-26',
  '6.298E+11,Wheat,H2,74.62,2-Nov-25,Goondiwindi East,0015120110,,1.00%,Sold,25/26,GROWER,W528,LANCER,BNR659,,11.20%,12.80%,82.1,,,,,2006537452,11-Sep-26',
].join('\n');

check('the headings of a GrainCorp file are guessed: the Paddock column is the outload number', () => {
  const { headers } = readTable(GRAINCORP);
  const m = guessMapping(headers);
  assert.equal(m.outloadNo, 'Paddock');
  assert.equal(m.netTons, 'Net Tonnes (mt)');
  assert.equal(m.date, 'Received Date');
  assert.equal(m.grade, 'Grade');
  assert.equal(m.commodity, 'Commodity');
  assert.equal(m.rego, 'Truck Rego');
  assert.equal(m.theirTicket, 'Ticket #');
  assert.equal(m.status, 'Status');
  assert.equal(m.moisturePct, 'MOGR');
  assert.equal(m.proteinPct, 'PRGR');
  assert.equal(m.screeningsPct, 'SCRN/IMPU');
  assert.equal(m.testWeightKgHl, 'TWT (kg/hl)');
  assert.equal(m.retentionPct, 'RET');
  assert.equal(m.oilPct, 'COIL');
  assert.equal(m.fallingNumber, 'FALL (s)');
  assert.equal(new Set(Object.values(m)).size, Object.keys(m).length, 'a heading is used for one thing only');
  assert.deepEqual(mappingProblems(m, headers), []);
});

check('what is still needed is said plainly', () => {
  const headers = ['A', 'B'];
  assert.equal(mappingProblems({}, headers).length, 2);
  assert.equal(mappingProblems({ outloadNo: 'A', netTons: 'B' }, headers).length, 0);
  assert.equal(mappingProblems({ outloadNo: 'A', grossTons: 'B' }, headers).length, 1, 'gross alone cannot give a net');
  assert.equal(mappingProblems({ outloadNo: 'A', grossTons: 'B', tareTons: 'A' }, headers).length, 0);
});

const table = readTable(GRAINCORP);
const mapping = guessMapping(table.headers);
const file = extractRows(table, mapping);

check('rows are read into the app\'s units: percentages without the sign, dates as dates, weights in tonnes', () => {
  assert.equal(file.rows.length, 5);
  const r = file.rows[0];
  assert.equal(r.outloadNo, '251001');
  assert.equal(r.net, 69.67);
  assert.equal(r.date, '2025-11-04');
  assert.equal(r.grade, 'APW1');
  assert.equal(r.rego, 'BNR659');
  assert.deepEqual(r.quality, { moisturePct: 9.4, proteinPct: 11, screeningsPct: 1.7, testWeightKgHl: 82 });
  assert.equal(file.rows[3].quality.retentionPct, 95.8);
  assert.equal(r.n, 2, 'the row number as a spreadsheet shows it');
});

check('a ticket number that Excel rounded (6.298E+11) is not used, and says so', () => {
  assert.equal(looksRounded('6.298E+11'), true);
  assert.equal(looksRounded('629812345678'), false);
  assert.equal(file.rows[0].theirTicket, '');
  assert.ok(file.rows[0].problems.some((p) => /rounded/.test(p)));
  const whole = extractRows(readTable(GRAINCORP.replace('6.298E+11,Wheat,APW1,69.67', '629812345678,Wheat,APW1,69.67')), mapping);
  assert.equal(whole.rows[0].theirTicket, '629812345678');
});

check('a blocked row, and one with no weight, are rejected rather than made final at nothing', () => {
  assert.equal(file.rows[2].rejected, true);
  assert.equal(file.rows[0].rejected, false);
});

check('kilograms: said, read from the heading, or noticed when no truck could be in tonnes', () => {
  const csv = 'No,Net kg,Date\n261001,28350,01/11/2026\n261002,29100,02/11/2026';
  const t = readTable(csv);
  const m = guessMapping(t.headers);
  assert.equal(extractRows(t, m).rows[0].net, 28.35, 'the heading says kg');
  assert.equal(extractRows(t, m, { units: 'kg' }).rows[0].net, 28.35);
  const plain = readTable('No,Net,Date\n261001,28350,01/11/2026');
  const guess = extractRows(plain, guessMapping(plain.headers));
  assert.equal(guess.rows[0].net, 28.35);
  assert.ok(guess.warnings.length, 'and the person is told');
  assert.equal(extractRows(plain, guessMapping(plain.headers), { units: 't' }).rows[0].net, 28350, 'unless they say tonnes');
});

check('gross and tare give the net when there is no net column; dates can be read the American way', () => {
  const t = readTable('Ref,Gross,Tare,Date\n261001,52.5,16.1,12/31/2026');
  const m = guessMapping(t.headers);
  const r = extractRows(t, m, { dateOrder: 'mdy' }).rows[0];
  assert.equal(r.net, 36.4);
  assert.equal(r.date, '2026-12-31');
});

check('a file with lines above the table: the person says which row has the headings', () => {
  const t = readTable('Delivery summary\nGenerated today\nNo,Net\n261001,30', { headerRow: 2 });
  assert.deepEqual(t.headers, ['No', 'Net']);
  assert.equal(t.rows.length, 1);
});

// ---- matching ----
const commodities = [{ id: 'w', name: 'Wheat' }, { id: 'b', name: 'Barley' }];
const loads = [
  { id: 'L1', outloadNo: '251001', truckRego: 'BNR659', date: '2025-11-04', commodityId: 'w', tons: 70, weightStatus: 'estimate', froms: [{ type: 'field', id: 'f1', tons: 40 }, { type: 'silo', id: 's1', tons: 30 }], tos: [{ type: 'silo', id: 'off', tons: 70 }] },
  { id: 'L2', outloadNo: '251002', truckRego: 'XXX111', date: '2025-11-04', commodityId: 'w', tons: 72, weightStatus: 'estimate', froms: [{ type: 'field', id: 'f2', tons: 72 }], tos: [{ type: 'silo', id: 'off', tons: 72 }] },
  { id: 'L4', outloadNo: '251004', truckRego: 'LE9END', date: '2025-10-27', commodityId: 'b', tons: 73.36, weightStatus: 'final', froms: [{ type: 'field', id: 'f3', tons: 73.36 }], tos: [{ type: 'silo', id: 'off', tons: 73.36 }] },
  { id: 'L9', outloadNo: '', truckRego: 'BNR659', date: '2025-11-02', commodityId: 'w', tons: 74, weightStatus: 'estimate', froms: [], tos: [] },
];
const result = matchDeliveries(file.rows, loads, { commodities, seasonYY: '25' });
const kinds = result.map((r) => r.kind);

check('a row whose number, truck, date and commodity fit is a match', () => {
  assert.equal(result[0].kind, 'match');
  assert.equal(result[0].load.id, 'L1');
});

check('a row whose truck differs from the load is for the person to look at, with the reason', () => {
  assert.equal(result[1].kind, 'review');
  assert.equal(result[1].load.id, 'L2');
  assert.ok(result[1].reasons.some((r) => /BNR659/.test(r) && /XXX111/.test(r)));
});

check('a rejected row changes nothing', () => {
  assert.equal(result[2].kind, 'rejected');
});

check('a load already final at the site\'s weight is left alone', () => {
  assert.equal(result[3].kind, 'same');
});

check('a row with no number is unmatched, and the same truck close in date is suggested', () => {
  assert.equal(result[4].kind, 'unmatched');
  assert.deepEqual(result[4].candidates.map((c) => c.load.id), ['L9']);
  assert.ok(/Same truck/.test(result[4].candidates[0].why));
  assert.deepEqual(kinds, ['match', 'review', 'rejected', 'same', 'unmatched']);
});

check('a number one digit off is suggested, and a number from another season says so', () => {
  const r = matchDeliveries(extractRows(readTable('No,Net,Date,Rego\n251009,30,2025-11-04,ZZZ999'), { outloadNo: 'No', netTons: 'Net', date: 'Date', rego: 'Rego' }).rows,
    [{ id: 'A', outloadNo: '251101', truckRego: 'AAA111', date: '2025-11-04' }, { id: 'B', outloadNo: '251008', truckRego: 'BBB222', date: '2025-11-04' }], { seasonYY: '26' })[0];
  assert.equal(r.kind, 'unmatched');
  assert.deepEqual(r.candidates.map((c) => c.load.id), ['B']);
  assert.ok(r.reasons.some((x) => /season 25/.test(x)));
});

check('two loads with the same number: the truck tells them apart, otherwise the person is asked', () => {
  const two = [
    { id: 'P', outloadNo: '261001', truckRego: 'AAA111', date: '2026-11-04', commodityId: 'w' },
    { id: 'Q', outloadNo: '261001', truckRego: 'BBB222', date: '2026-11-04', commodityId: 'w' },
  ];
  const rows = extractRows(readTable('No,Net,Rego,Date\n261001,30,BBB222,2026-11-04\n261001,31,CCC333,2026-11-04'), { outloadNo: 'No', netTons: 'Net', rego: 'Rego', date: 'Date' }).rows;
  const r = matchDeliveries(rows, two, { commodities });
  assert.equal(r[0].kind, 'match');
  assert.equal(r[0].load.id, 'Q');
  assert.equal(r[1].kind, 'review');
  assert.equal(r[1].candidates.length, 2);
});

check('two rows for one load: the second is flagged, not silently applied on top', () => {
  const rows = extractRows(readTable('No,Net\n261001,30\n261001,31'), { outloadNo: 'No', netTons: 'Net' }).rows;
  const r = matchDeliveries(rows, [{ id: 'P', outloadNo: '261001', date: '2026-11-04' }]);
  assert.equal(r[0].kind, 'match');
  assert.equal(r[1].kind, 'review');
  assert.ok(r[1].reasons.some((x) => /already for this load/.test(x)));
});

// ---- what changes ----
check('the site\'s weight is shared out over the sources in proportion, the last taking the remainder, so they add up exactly', () => {
  const legs = prorateLegs([{ id: 'a', tons: 24 }, { id: 'b', tons: 16 }, { id: 'c', tons: 10 }], 48.6);
  assert.deepEqual(legs.map((l) => l.tons), [23.328, 15.552, 9.72]);
  assert.equal(Math.round(legs.reduce((a, l) => a + l.tons, 0) * 1000) / 1000, 48.6);
  const odd = prorateLegs([{ tons: 1 }, { tons: 1 }, { tons: 1 }], 10);
  assert.equal(Math.round(odd.reduce((a, l) => a + l.tons, 0) * 1000) / 1000, 10);
  assert.deepEqual(prorateLegs([{ tons: 0 }, { tons: 0 }], 10).map((l) => l.tons), [5, 5], 'nothing estimated: shared equally');
  assert.deepEqual(prorateLegs([], 10), []);
  assert.equal(prorateLegs([{ id: 'x', __legId: 'k', tons: 5 }], 6)[0].__legId, 'k', 'the leg keeps its identity');
});

check('the patch makes the load final at the site\'s weight, with its grade, readings and a note of what we had', () => {
  const p = deliveryPatch(loads[0], file.rows[0], { today: '16-11-2026' });
  assert.equal(p.id, 'L1');
  assert.equal(p.tons, 69.67);
  assert.equal(p.weightStatus, 'final');
  assert.equal(p.grade, 'APW1');
  assert.equal(p.proteinPct, 11);
  assert.equal(p.moisturePct, 9.4);
  assert.equal(Math.round(p.froms.reduce((a, l) => a + l.tons, 0) * 1000) / 1000, 69.67);
  assert.equal(p.tos[0].tons, 69.67);
  assert.ok(/Site weight 69.67 t, we had 70 t \(estimate\)/.test(p.notes));
  assert.ok(!('externalTicketNo' in p), 'the rounded ticket number was not used');
  assert.ok(!('oilPct' in p), 'what the file does not have is not touched');
});

check('a note is added only when the weight changed', () => {
  const same = deliveryPatch({ id: 'S', tons: 69.67, weightStatus: 'final', notes: 'hello', froms: [], tos: [] }, file.rows[0]);
  assert.ok(!('notes' in same));
});

// ---- saved layouts ----
check('a layout is saved by name, replaced when the name is used again, recognised by its headings, and removed', () => {
  const f = makeFormat({ name: 'GrainCorp', mapping, units: 't', dateOrder: 'dmy' });
  assert.equal(f.name, 'GrainCorp');
  let list = saveFormat([], f);
  list = saveFormat(list, makeFormat({ name: 'graincorp', mapping: { ...mapping, grade: 'Variety Name' } }));
  assert.equal(list.length, 1, 'the same name replaces');
  assert.equal(list[0].mapping.grade, 'Variety Name');
  const found = findFormat(list, table.headers);
  assert.equal(found.name, 'graincorp');
  assert.equal(findFormat(list, ['Something', 'Else']), null);
  assert.equal(findFormat(list, table.headers.filter((h) => h !== 'Paddock')), null, 'without the outload column it does not fit');
  assert.deepEqual(removeFormat(list, 'GRAINCORP'), []);
});

check('a layout survives being saved on the farm: sent once there is one, and an emptied list still reaches the server', () => {
  const FARM = '99999999-9999-9999-9999-999999999999';
  const state = (b) => ({ currentYear: '2026', nextMovementNo: 1, businessDetails: b, years: { 2026: { commodities: [], fields: [], storages: [], sales: [], movements: [], overheads: {}, invoices: [], payables: [] } } });
  assert.ok(!('import_formats' in stateToRows(state({ farmName: 'X' }), FARM).farms[0]));
  const fmt = makeFormat({ name: 'GrainCorp', mapping });
  const rows = stateToRows(state({ farmName: 'X', importFormats: [fmt] }), FARM);
  assert.deepEqual(rows.farms[0].import_formats, [fmt]);
  assert.deepEqual(rowsToState(rows).businessDetails.importFormats, [fmt]);
  const cleared = stateToRows(state({ farmName: 'X', importFormats: [], __hasImportFormats: true }), FARM);
  assert.deepEqual(cleared.farms[0].import_formats, []);
});

check('the outload number is saved on the load and comes back; a load without one sends no column', () => {
  const FARM = '99999999-9999-9999-9999-999999999999';
  const SID = '11111111-1111-1111-1111-111111111111';
  const mv = (extra) => ({ id: '22222222-2222-2222-2222-222222222222', ticketNo: 5, date: '2026-11-05', tons: 30, weightStatus: 'estimate', froms: [], tos: [], ...extra });
  const state = (m) => ({ currentYear: '2026', nextMovementNo: 6, businessDetails: { farmName: 'X' }, years: { 2026: { __seasonId: SID, commodities: [], fields: [], storages: [], sales: [], movements: [m], overheads: {}, invoices: [], payables: [] } } });
  const a = stateToRows(state(mv({ outloadNo: '261007' })), FARM);
  assert.equal(a.movements[0].outload_no, '261007');
  assert.equal(rowsToState(a).years[2026].movements[0].outloadNo, '261007');
  assert.ok(!('outload_no' in stateToRows(state(mv({})), FARM).movements[0]));
  const b = stateToRows(state(mv({ outloadNo: '', __hasOutloadNo: true })), FARM);
  assert.ok('outload_no' in b.movements[0], 'cleared after being set still reaches the server');
});

check('every column the importer can fill has a heading it recognises', () => {
  for (const f of DELIVERY_FIELDS) assert.ok(f.synonyms.length > 0, f.key);
});

check('it is wired: the load form, the data layer, boot, People and the SQL', () => {
  const mv = read('docs/js/views/movements.js');
  assert.ok(mv.includes('id="outloadNo"') && mv.includes('id="ol-get"') && mv.includes('outloadNo: olNo') && mv.includes('id="get-outload"'));
  assert.ok(mv.includes('is already on load #'), 'a number on another load is refused');
  const st = read('docs/js/storage.js');
  assert.ok(st.includes('nextOutloadNo()') && st.includes('__hasOutloadNo') && st.includes('__hasImportFormats'));
  const mn = read('docs/js/main.js');
  assert.ok(mn.includes('loadMySeries(myId, membership.farmId)') && mn.includes('rememberedSeries(myId, membership.farmId)'));
  const se = read('docs/js/views/settings.js');
  assert.ok(se.includes('listSeries(farmId)') && se.includes("id: 'mem-series'") && se.includes('setMemberSeries'));
  assert.ok(se.includes('id="import-deliveries"'), 'Settings opens the delivery import');
  const sql = read('supabase/migrations/20261118600000_outload_numbers.sql');
  for (const w of ['outload_series', 'farm_users_outload_series_unique', 'assign_outload_series', 'outload_no text', 'import_formats jsonb']) assert.ok(sql.includes(w), w);
  const paste = read('supabase/paste-into-sql-editor.sql');
  assert.ok(paste.includes('Build 308') && paste.includes('assign_outload_series') && paste.includes('import_formats jsonb'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
