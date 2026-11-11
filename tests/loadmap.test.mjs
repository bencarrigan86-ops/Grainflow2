// Run with:
//   node tests/loadmap.test.mjs
//
// Matching someone else's truck-loads file to what the importer needs: guessed
// from the headings, remembered, and asked about again only when it stops fitting.
import assert from 'node:assert/strict';
import {
  guessColumns, signature, chooseSetup, rememberSetup, recallSetups, setupProblems, platformFits,
  peekFile, distinctOf, likelyFinished, looksLikeKilograms, normHeader,
} from '../docs/js/loadmap.js';
import { readFreightExport, parseDate, detectDelimiter, buildMovements, PLATFORM_SETUP } from '../docs/js/loadimport.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const memory = () => { const d = {}; return { getItem: (k) => d[k] ?? null, setItem: (k, v) => { d[k] = v; } }; };

// three quite different layouts
const PLATFORM = 'Movement No,Status,Commodity,Pickup Date,Pickup Storage,Pickup Rego,Pickup Grade,Pickup Net Weight,Delivery Time,Delivery Storage,Delivery Net Weight';
const FARMER = 'Date,Paddock,Silo,Crop,Truck,Net kg,Grade,Moisture,Protein';
const SPREADSHEET = 'Ticket;Load Date;Field Name;Bin;Product;Net Weight (t)';

console.log('\n=== guessing from headings ===');

check('the platform\'s own headings are recognised as that platform', () => {
  assert.equal(platformFits(PLATFORM.split(',')), true);
  assert.equal(platformFits(FARMER.split(',')), false);
});
check('a farmer\'s own spreadsheet is matched on the names alone', () => {
  const g = guessColumns(FARMER.split(','));
  assert.equal(g.date, 'Date');
  assert.equal(g.field, 'Paddock');
  assert.equal(g.silo, 'Silo');
  assert.equal(g.commodity, 'Crop');
  assert.equal(g.deliveryTons, 'Net kg');
  assert.equal(g.rego, 'Truck');
  assert.equal(g.moisturePct, 'Moisture');
  assert.equal(g.proteinPct, 'Protein');
});
check('a semicolon spreadsheet with a ticket number is matched', () => {
  const g = guessColumns(SPREADSHEET.split(';'));
  assert.equal(g.ref, 'Ticket');
  assert.equal(g.date, 'Load Date');
  assert.equal(g.field, 'Field Name');
  assert.equal(g.silo, 'Bin');
  assert.equal(g.commodity, 'Product');
  assert.equal(g.deliveryTons, 'Net Weight (t)');
});
check('a heading is only ever used for one thing', () => {
  const g = guessColumns(['Net Weight', 'Date', 'Paddock', 'Silo', 'Crop']);
  const used = Object.values(g);
  assert.equal(new Set(used).size, used.length);
});
check('a unit in the heading is noticed', () => {
  assert.equal(looksLikeKilograms('Net kg'), true);
  assert.equal(looksLikeKilograms('Weight (KG)'), true);
  assert.equal(looksLikeKilograms('Net Weight (t)'), false);
  assert.equal(looksLikeKilograms('Kangaroo'), false);
});

console.log('\n=== asked once, then remembered ===');

check('a file nobody has matched yet has to be confirmed, starting from the guess', () => {
  const c = chooseSetup(FARMER.split(','), {});
  assert.equal(c.confirm, true);
  assert.equal(c.source, 'guess');
  assert.equal(c.setup.columns.field, 'Paddock');
  assert.equal(c.setup.unit, 'kg', 'a kilogram heading starts the unit as kilograms');
});
check('the platform\'s file never has to be matched', () => {
  const c = chooseSetup(PLATFORM.split(','), {});
  assert.equal(c.confirm, false);
  assert.equal(c.source, 'platform');
});
check('once matched, the same file opens straight away', () => {
  const store = memory();
  const headers = FARMER.split(',');
  const first = chooseSetup(headers, recallSetups(store));
  rememberSetup(store, headers, first.setup);
  const second = chooseSetup(headers, recallSetups(store));
  assert.equal(second.confirm, false);
  assert.equal(second.source, 'saved');
  assert.deepEqual(second.setup.columns, first.setup.columns);
});
check('the same headings in a different order, case and spacing are still recognised', () => {
  const a = signature(FARMER.split(','));
  const b = signature(FARMER.split(',').reverse().map((h) => ` ${h.toUpperCase()} `));
  assert.equal(a, b);
});
check('next month\'s file with an extra column still opens without asking', () => {
  const store = memory();
  const headers = FARMER.split(',');
  rememberSetup(store, headers, chooseSetup(headers, {}).setup);
  const c = chooseSetup([...headers, 'Notes'], recallSetups(store));
  assert.equal(c.confirm, false);
});
check('when a heading the setup relied on has gone, it asks again and keeps what still works', () => {
  const store = memory();
  const headers = FARMER.split(',');
  rememberSetup(store, headers, chooseSetup(headers, {}).setup);
  const renamed = headers.map((h) => (h === 'Paddock' ? 'Field' : h));
  const c = chooseSetup(renamed, recallSetups(store));
  assert.equal(c.confirm, true);
  assert.equal(c.setup.columns.silo, 'Silo', 'what still fits is kept');
  assert.equal(c.setup.columns.field, 'Field', 'and the renamed one is found');
  assert.ok(c.problems.some((p) => /Paddock/.test(p)));
});
check('a needed column that was never matched is a problem', () => {
  const p = setupProblems({ columns: { date: 'Date' } }, ['Date']);
  assert.ok(p.some((x) => /Paddock/.test(x)));
  assert.ok(p.some((x) => /Silo/.test(x)));
});
check('the choices survive being saved and read back', () => {
  const store = memory();
  const headers = SPREADSHEET.split(';');
  const setup = { ...chooseSetup(headers, {}).setup, dateOrder: 'mdy' };
  rememberSetup(store, headers, setup);
  assert.equal(recallSetups(store).bySignature[signature(headers)].dateOrder, 'mdy');
});

console.log('\n=== reading a file with a setup ===');

check('dates are read in the order the person says', () => {
  assert.equal(parseDate('05/01/2027', 'dmy'), '2027-01-05');
  assert.equal(parseDate('05/01/2027', 'mdy'), '2027-05-01');
  assert.equal(parseDate('2027/01/05', 'ymd'), '2027-01-05');
  assert.equal(parseDate('2027-01-05', 'mdy'), '2027-01-05', 'an ISO date is the same either way');
  assert.equal(parseDate('28 Oct 2026', 'mdy'), '2026-10-28');
  assert.equal(parseDate('Oct 28, 2026', 'dmy'), '2026-10-28');
  assert.equal(parseDate('13/13/2026', 'dmy'), null);
  assert.equal(parseDate('whenever', 'dmy'), null);
});
check('semicolons and tabs are detected', () => {
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(detectDelimiter('a\tb\tc'), '\t');
  assert.equal(detectDelimiter('a,b,c'), ',');
  assert.equal(detectDelimiter('"a;b",c,d'), ',', 'a separator inside quotes does not count');
});
check('a farmer\'s kilogram spreadsheet, with no load number and no status, reads cleanly', () => {
  const csv = `${FARMER}\n01/11/2026,A7,20 Silo,Wheat,TAMBO,30500,APH1,11.2,12.4\n01/11/2026,A7,20 Silo,Wheat,TAMBO,29800,APH1,11.0,12.1`;
  const setup = { ...chooseSetup(FARMER.split(','), {}).setup, completed: [] };
  const { loads, missingColumns } = readFreightExport(csv, setup);
  assert.deepEqual(missingColumns, []);
  assert.equal(loads.length, 2);
  assert.equal(loads[0].deliveryTons, 30.5, 'kilograms become tonnes');
  assert.equal(loads[0].quality.moisturePct, 11.2);
  assert.equal(loads[0].quality.proteinPct, 12.4);
  assert.equal(loads[0].check, 'ok', 'no second weight, so nothing to check against');
  assert.equal(loads.every((l) => l.finished), true, 'no status column: every load happened');
  assert.deepEqual(loads.map((l) => l.problems), [[], []]);
});
check('loads with no number are given steady ones, so the same file twice is recognised', () => {
  const csv = `${FARMER}\n01/11/2026,A7,20 Silo,Wheat,TAMBO,30500,APH1,11.2,12.4\n02/11/2026,B3,20 Silo,Wheat,ROMA,29800,APH1,11.0,12.1`;
  const setup = chooseSetup(FARMER.split(','), {}).setup;
  const one = readFreightExport(csv, setup).loads;
  const two = readFreightExport(csv, setup).loads;
  assert.deepEqual(one.map((l) => l.ref), two.map((l) => l.ref), 'the same every time');
  assert.notEqual(one[0].ref, one[1].ref);
  assert.equal(one[0].synthetic, true);
  const maps = { fields: { A7: 'f1', B3: 'f2' }, silos: { '20 Silo': 's1' }, commodities: { Wheat: 'c1' } };
  const first = buildMovements(one, maps);
  assert.equal(first.movements.length, 2);
  const again = buildMovements(two, maps, { existing: first.movements });
  assert.equal(again.movements.length, 0);
  assert.equal(again.duplicates, 2);
});
check('two identical loads in one file are two loads, not one', () => {
  const line = '01/11/2026,A7,20 Silo,Wheat,TAMBO,30500,APH1,11.2,12.4';
  const csv = `${FARMER}\n${line}\n${line}`;
  const { loads } = readFreightExport(csv, chooseSetup(FARMER.split(','), {}).setup);
  assert.notEqual(loads[0].ref, loads[1].ref);
});
check('a semicolon file with a ticket number and month-first dates is read as asked', () => {
  const csv = `${SPREADSHEET}\nT100;10/28/2026;North;1 Silo;Wheat;30.5`;
  const setup = { ...chooseSetup(SPREADSHEET.split(';'), {}).setup, dateOrder: 'mdy' };
  const { loads } = readFreightExport(csv, setup);
  assert.equal(loads[0].ref, 'T100');
  assert.equal(loads[0].date, '2026-10-28');
  assert.equal(loads[0].deliveryTons, 30.5);
  assert.equal(loads[0].synthetic, undefined);
});
check('a status column with the person\'s own words for finished: only those loads count', () => {
  const csv = 'Date,Paddock,Silo,Crop,Net t,State\n01/11/2026,A,S,Wheat,30,Done\n01/11/2026,A,S,Wheat,30,Cancelled';
  const headers = csv.split('\n')[0].split(',');
  const setup = { ...chooseSetup(headers, {}).setup, completed: ['Done'] };
  const { loads } = readFreightExport(csv, setup);
  assert.deepEqual(loads.map((l) => l.finished), [true, false]);
  const r = buildMovements(loads, { fields: { A: 'f' }, silos: { S: 's' }, commodities: {} });
  assert.equal(r.movements.length, 1);
  assert.equal(r.skipped.length, 1);
});
check('a file missing a needed column is named, not half-read', () => {
  const r = readFreightExport('Date,Crop\n1/1/2026,Wheat', { columns: { date: 'Date', commodity: 'Crop', field: 'Paddock', silo: 'Silo', deliveryTons: 'Net' } });
  assert.deepEqual(r.missingColumns.sort(), ['Paddock', 'Silo']);
  assert.equal(r.loads.length, 0);
});
check('the platform\'s own file still reads exactly as before', () => {
  const csv = `${PLATFORM}\nM1,Completed,Wheat,01/11/2026,A7,T1,APH1,30,10:00,20 Silo,30`;
  const r = readFreightExport(csv);
  assert.equal(r.loads[0].ref, 'M1');
  assert.equal(r.loads[0].deliveryTons, 30);
  assert.equal(r.loads[0].check, 'ok');
  assert.equal(r.loads[0].finished, true);
  assert.equal(r.loads[0].synthetic, undefined);
});

console.log('\n=== choosing statuses ===');

check('the distinct values of a column, most frequent first', () => {
  const { headers, rows } = peekFile('Status,x\nDone,1\nDone,2\nCancelled,3');
  assert.deepEqual(distinctOf(rows, headers, 'status'), [{ value: 'Done', n: 2 }, { value: 'Cancelled', n: 1 }]);
});
check('likely "finished" words are offered as the starting choice', () => {
  assert.equal(likelyFinished('Completed'), true);
  assert.equal(likelyFinished('delivered'), true);
  assert.equal(likelyFinished('Cancelled'), false);
  assert.equal(likelyFinished('In transit'), false);
});
check('headings compare with punctuation and spacing ignored', () => {
  assert.equal(normHeader('Net Weight (kg)'), 'netweightkg');
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
