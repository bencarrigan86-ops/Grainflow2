#!/usr/bin/env node
//
// Bringing truck loads in from a weighbridge export.
//
//   node tests/loadimport.test.mjs
//
// The rows below are invented, but the awkward shapes are real ones from the
// export this was written against: paddock names that differ from the app's by
// a leading zero, a silo whose suffix differs, a trailing space, a load with no
// delivery weight, a row that was never completed, and a stub with nothing but a movement number.
//
// What these protect: a load must not be credited to the wrong paddock, must
// not be counted twice if the file is imported twice, and must not vanish
// without being listed.

import assert from 'node:assert';
import {
  parseCsv, nameKey, matchName, suggestNames, matchCommodity, isoFromDmy,
  readFreightExport, weightCheck, planNames, buildMovements, refFromNotes,
  matchSiloByNumber, suggestCutoff, targetOf,
} from '../docs/js/loadimport.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

const HEADER = 'Movement No,Status,Commodity,Pickup Date,Pickup Storage,Pickup Rego,Pickup Grade,Pickup Net Weight,Delivery Time,Delivery Storage,Delivery Net Weight';
const CSV = [
  HEADER,
  'M01,Completed,Wheat,28/10/2026,A07,TAMBO,APH1,30.0,02:39 PM,14 Silo (Sunmaster),30.5',
  'M02,Completed,Wheat,28/10/2026,A07 ,ROMA,APH1,20.0,02:40 PM,20 Silo,20.0',
  'M03,Completed,Barley,29/10/2026,W3/4,TWBA,BAR1,40.0,09:00 AM,"Bunker - Barley, Sunnyridge",',
  'M04,Completed,Chickpeas (Desi),30/10/2026,SR05/6,TWBA,CHK1 - Desi,38.0,10:00 AM,Kot02,38.0',
  'M05,Cancelled,Wheat,30/10/2026,A06,TAMBO,APH1,10.0,11:00 AM,20 Silo,10.0',
  'M06,Completed,Wheat,31/10/2026,SR01-3,TAMBO,APH1,,12:00 PM,06 Silo ,',
  ',,,,,,,,,,',          // a wholly blank line, as a spreadsheet export sometimes ends with
  'M08,,,,,,,,,,',        // a stub: a movement number and nothing else
  'M07,Completed,Wheat,31/10/2026,,TAMBO,APH1,10.0,12:30 PM,20 Silo,10.0',
].join('\r\n');

const FIELDS = [
  { id: 'f-a7', name: 'A7' }, { id: 'f-a6', name: 'A6' }, { id: 'f-sr56', name: 'SR5/6' },
  { id: 'f-sr13', name: 'SR1-3' }, { id: 'f-srn13', name: 'SR13' }, { id: 'f-w3', name: 'W3' }, { id: 'f-w4', name: 'W4' },
];
const SILOS = [
  { id: 's-14', name: '14 Silo (Lancer Seed)' }, { id: 's-20', name: '20 Silo' }, { id: 's-6', name: '06 Silo' },
  { id: 's-k2', name: 'Kot 2' }, { id: 's-k3', name: 'Kot 3' },
];
const COMMODITIES = [{ id: 'c-w', name: 'Wheat' }, { id: 'c-b', name: 'Barley' }, { id: 'c-c', name: 'Chickpeas' }];

console.log('\n=== reading the file ===');

check('a quoted cell with a comma stays one cell, and CRLF and a BOM are fine', () => {
  const rows = parseCsv('﻿a,b\r\n"x, y",2\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', '2']]);
});
check('doubled quotes inside a quoted cell become one quote', () => {
  assert.deepEqual(parseCsv('a\n"say ""hi"""\n'), [['a'], ['say "hi"']]);
});
check('dates are read day first, and nonsense is refused rather than guessed', () => {
  assert.equal(isoFromDmy('28/10/2026'), '2026-10-28');
  assert.equal(isoFromDmy('5/1/2027'), '2027-01-05');
  assert.equal(isoFromDmy('11/11/26'), '2026-11-11', 'the same file after a spreadsheet has saved it');
  assert.equal(isoFromDmy('2026-10-28'), '2026-10-28');
  assert.equal(isoFromDmy('31/13/2026'), null);
  assert.equal(isoFromDmy(''), null);
});
check('columns are found by header, so their order does not matter', () => {
  const shuffled = 'Pickup Storage,Movement No,Delivery Storage,Commodity,Pickup Date,Pickup Net Weight\nA7,M9,20 Silo,Wheat,01/11/2026,12';
  const { loads, missingColumns } = readFreightExport(shuffled);
  assert.deepEqual(missingColumns, []);
  assert.equal(loads[0].ref, 'M9');
  assert.equal(loads[0].field, 'A7');
  assert.equal(loads[0].pickupTons, 12);
});
check('a file that is not this export is named as such, not half-read', () => {
  const r = readFreightExport('Name,Amount\nx,1');
  assert.ok(r.missingColumns.includes('Pickup Storage'));
  assert.equal(r.loads.length, 0);
});

const { loads } = readFreightExport(CSV);

check('every row is kept, including the unusable ones, with a reason', () => {
  assert.equal(loads.length, 8, 'the wholly blank line is not a load, but the stub is');
  const stub = loads.find((l) => l.ref === 'M08');
  assert.ok(stub.problems.length >= 3, 'the blank stub row should be refused for several reasons');
  assert.ok(loads.find((l) => l.ref === 'M07').problems.some((p) => /paddock/.test(p)));
});

console.log('\n=== matching names ===');

check('leading zeros, case and stray spaces do not stop a match', () => {
  assert.equal(nameKey('A07'), nameKey('A7'));
  assert.equal(nameKey('Kot02'), nameKey('Kot 2'));
  assert.equal(nameKey('06 Silo '), nameKey('06 Silo'));
  assert.equal(nameKey('SR01-3'), nameKey('SR1-3'));
});
check('SR01-3 is the paddock group SR1-3 and not SR13', () => {
  assert.notEqual(nameKey('SR01-3'), nameKey('SR13'));
  assert.equal(matchName('SR01-3', FIELDS).id, 'f-sr13');
  assert.equal(matchName('SR13', FIELDS).id, 'f-srn13');
});
check('the export\'s spellings find the app\'s records', () => {
  assert.equal(matchName('A07 ', FIELDS).id, 'f-a7');
  assert.equal(matchName('SR05/6', FIELDS).id, 'f-sr56');
  assert.equal(matchName('Kot02', SILOS).id, 's-k2');
  assert.equal(matchName('06 Silo ', SILOS).id, 's-6');
});
check('a name with no certain match is left for the person, not guessed', () => {
  assert.equal(matchName('W3/4', FIELDS), null, 'W3/4 is two paddocks in the app');
  assert.equal(matchName('14 Silo (Sunmaster)', SILOS), null, 'the suffix differs');
  assert.equal(matchName('Bunker - Barley Sunnyridge', SILOS), null);
});
check('two records that normalise alike are ambiguous, so neither is chosen', () => {
  assert.equal(matchName('A7', [{ id: 'x', name: 'A07' }, { id: 'y', name: 'A7' }]), null);
});
check('a near miss is offered as a suggestion', () => {
  assert.deepEqual(suggestNames('14 Silo (Sunmaster)', SILOS).map((s) => s.id), ['s-14']);
  assert.deepEqual(suggestNames('W3/4', FIELDS).map((s) => s.id).sort(), ['f-w3'].sort());
});
check('"Chickpeas (Desi)" is Chickpeas', () => {
  assert.equal(matchCommodity('Chickpeas (Desi)', COMMODITIES).id, 'c-c');
  assert.equal(matchCommodity('Wheat', COMMODITIES).id, 'c-w');
  assert.equal(matchCommodity('Sorghum', COMMODITIES), null);
});

console.log('\n=== the weight check ===');

check('equal weights pass, to the rounding on the scale', () => {
  assert.equal(weightCheck({ pickupTons: 30, deliveryTons: 30 }), 'ok');
  assert.equal(weightCheck({ pickupTons: 30, deliveryTons: 30.04 }), 'ok');
});
check('weights that disagree are flagged', () => {
  assert.equal(weightCheck({ pickupTons: 22, deliveryTons: 38 }), 'differs');
  assert.equal(weightCheck({ pickupTons: 30, deliveryTons: 30.5 }), 'differs');
});
check('no outload weight means nothing to check against, which is not a pass', () => {
  assert.equal(weightCheck({ pickupTons: null, deliveryTons: 35 }), 'unchecked');
});
check('the check is on each load as it is read', () => {
  const by = Object.fromEntries(loads.map((l) => [l.ref, l.check]));
  assert.equal(by.M02, 'ok');
  assert.equal(by.M01, 'differs');
  assert.equal(by.M03, 'unchecked');
});
check('the grade is the pickup grade, or the delivered one if that is blank', () => {
  const { loads: g } = readFreightExport('Movement No,Status,Commodity,Pickup Date,Pickup Storage,Delivery Storage,Pickup Grade,Delivery Grade,Delivery Net Weight\nA1,Completed,Wheat,01/11/2026,A7,20 Silo,,APH1,10\nA2,Completed,Wheat,01/11/2026,A7,20 Silo,AUH1,APH1,10');
  assert.equal(g[0].grade, 'APH1');
  assert.equal(g[1].grade, 'AUH1');
});

console.log('\n=== building movements ===');

const planned = {
  fields: Object.fromEntries(planNames(loads, 'field', FIELDS).map((p) => [p.name, p.match?.id ?? null])),
  silos: Object.fromEntries(planNames(loads, 'silo', SILOS).map((p) => [p.name, p.match?.id ?? null])),
  commodities: Object.fromEntries([...new Set(loads.map((l) => l.commodity).filter(Boolean))].map((n) => [n, matchCommodity(n, COMMODITIES)?.id ?? null])),
};
// the person resolves what could not be matched
planned.fields['W3/4'] = 'f-w3';
planned.silos['14 Silo (Sunmaster)'] = 's-14';
planned.silos['Bunker - Barley, Sunnyridge'] = 's-20';

check('only loads that pass every check become movements', () => {
  const r = buildMovements(loads, planned);
  assert.deepEqual(r.movements.map((m) => refFromNotes(m.notes)), ['M02', 'M04']);
});
check('a load whose weights disagree is held with both weights shown, not imported', () => {
  const r = buildMovements(loads, planned);
  const h = r.held.find((x) => x.load.ref === 'M01');
  assert.ok(h, 'M01 should be held');
  assert.ok(h.why.includes('30') && h.why.includes('30.5'));
  assert.ok(!r.movements.some((m) => m.notes.includes('M01')));
});
check('a held load comes in when the person chooses it, with the delivered weight', () => {
  const r = buildMovements(loads, planned, { include: new Set(['M01']) });
  const m = r.movements.find((x) => x.notes.includes('M01'));
  assert.ok(m, 'M01 should now be imported');
  assert.equal(m.tons, 30.5, 'the delivered weight, not the outload weight');
  assert.equal(r.held.some((x) => x.load.ref === 'M01'), false);
});
check('unusable and cancelled rows are skipped, each with its reason', () => {
  const r = buildMovements(loads, planned);
  const by = Object.fromEntries(r.skipped.map((s) => [s.load.ref, s.why]));
  assert.ok(by.M03.includes('delivered weight'), 'M03 has no delivered weight');
  assert.ok(by.M05.includes('Cancelled'));
  assert.ok(by.M06.includes('weight'));
  assert.ok(by.M07.includes('paddock'));
  assert.ok(by.M08);
});
check('a movement goes from the paddock to the silo with the delivered weight on both legs', () => {
  const m = buildMovements(loads, planned).movements[0];
  assert.deepEqual(m.froms, [{ type: 'field', id: 'f-a7', tons: 20 }]);
  assert.deepEqual(m.tos, [{ type: 'silo', id: 's-20', tons: 20 }]);
  assert.equal(m.tons, 20);
  assert.equal(m.weightStatus, 'final');
  assert.equal(m.truckRego, 'ROMA');
  assert.equal(m.commodityId, 'c-w');
  assert.equal(m.date, '2026-10-28');
});
check('the grade and the platform\'s movement number are kept in the notes, and read back', () => {
  const m = buildMovements(loads, planned).movements[0];
  assert.equal(m.notes, 'Import M02 · APH1');
  assert.equal(refFromNotes(m.notes), 'M02');
  assert.equal(refFromNotes('hand-typed note'), null);
});
check('importing the same file twice adds nothing the second time', () => {
  const first = buildMovements(loads, planned);
  const again = buildMovements(loads, planned, { existing: first.movements });
  assert.equal(again.movements.length, 0);
  assert.equal(again.duplicates, 2);
});
check('an overlapping file adds only the new loads', () => {
  const first = buildMovements(loads.filter((l) => l.ref === 'M02'), planned);
  const second = buildMovements(loads, planned, { existing: first.movements });
  assert.deepEqual(second.movements.map((m) => refFromNotes(m.notes)), ['M04']);
  assert.equal(second.duplicates, 1);
});
check('the same movement number twice in one file is imported once', () => {
  const twice = [...loads, { ...loads.find((l) => l.ref === 'M02'), line: 99 }];
  assert.equal(buildMovements(twice, planned).movements.filter((m) => m.notes.includes('M02')).length, 1);
});
check('loads come out oldest first, so ticket numbers follow the order they happened in', () => {
  const dates = buildMovements(loads, planned, { include: new Set(['M01']) }).movements.map((m) => m.date);
  assert.deepEqual(dates, [...dates].sort());
});
check('a paddock set to skip drops its loads and says so', () => {
  const r = buildMovements(loads, { ...planned, fields: { ...planned.fields, A07: null, 'A07 ': null } });
  assert.ok(r.skipped.some((s) => /skipped/.test(s.why)));
  assert.ok(r.movements.every((m) => !m.notes.includes('M02')));
});

console.log('\n=== silo numbers, blended loads and split names ===');

const REAL_SILOS = [
  { id: 's-14', name: '14 Silo (Lancer Seed)' }, { id: 's-02', name: '02 silo (Lancer seed)' },
  { id: 's-04', name: '04 Silo ( Captain seed)' }, { id: 's-a6', name: 'A06 Silo' }, { id: 's-20', name: '20 Silo' },
];
check('a silo is found by its number, whatever is written in the brackets', () => {
  assert.equal(matchSiloByNumber('14 Silo (Sunmaster)', REAL_SILOS).id, 's-14');
  assert.equal(matchSiloByNumber('02 Silo (Lancer Wheat Seed)', REAL_SILOS).id, 's-02');
  assert.equal(matchSiloByNumber('04 Silo (Sunmaster Seed)', REAL_SILOS).id, 's-04');
  assert.equal(matchSiloByNumber('20 Silo', REAL_SILOS).id, 's-20');
});
check('"A05 Silo" is not silo 5, and a number with no silo in the app is left for the person', () => {
  assert.equal(matchSiloByNumber('A05 Silo', REAL_SILOS), null);
  assert.equal(matchSiloByNumber('A10 Silo', REAL_SILOS), null);
  assert.equal(matchSiloByNumber('11 Silo', REAL_SILOS), null);
});
check('two silos with the same number are ambiguous, so neither is chosen', () => {
  const two = [{ id: 'x', name: '14 Silo (A)' }, { id: 'y', name: '14 Silo (B)' }];
  assert.equal(matchSiloByNumber('14 Silo (C)', two), null);
});
check('a blended load offers each paddock it names', () => {
  const s = suggestNames('A07 | B03', [{ id: 'f-a7', name: 'A7' }, { id: 'f-b3', name: 'B3' }, { id: 'f-b4', name: 'B4' }]);
  assert.deepEqual(s.map((x) => x.id), ['f-a7', 'f-b3']);
});
check('the weight of a blended load can be put against one paddock', () => {
  const csvBlend = [HEADER, 'M20,Completed,Wheat,29/10/2026,A07 | B03,TAMBO,APH1,54,05:04 PM,20 Silo,54'].join('\n');
  const { loads: bl } = readFreightExport(csvBlend);
  const r = buildMovements(bl, { fields: { 'A07 | B03': 'f-b3' }, silos: { '20 Silo': 's-20' }, commodities: { Wheat: 'c-w' } });
  assert.deepEqual(r.movements[0].froms, [{ type: 'field', id: 'f-b3', tons: 54 }]);
});

const DAM = [HEADER,
  'M31,Completed,Wheat,06/11/2026,SR Dam,TAMBO,APH1,55,10:16 AM,20 Silo,55',
  'M32,Completed,Wheat,06/11/2026,SR Dam,TAMBO,APH1,61,10:16 AM,20 Silo,61',
  'M33,Completed,Wheat,10/11/2026,SR Dam,ROMA,APH1,69,05:00 PM,20 Silo,69',
  'M34,Completed,Wheat,10/11/2026,SR Dam,ROMA,APH1,21,05:06 PM,20 Silo,21'].join('\n');
const { loads: damLoads } = readFreightExport(DAM);
check('the split lands at the biggest gap between days: the 10th', () => {
  assert.equal(suggestCutoff(damLoads, 'field', 'SR Dam'), '2026-11-10');
  assert.equal(suggestCutoff(damLoads.slice(0, 2), 'field', 'SR Dam'), null, 'one day has nothing to split');
});
check('earlier loads go to one paddock and later loads to the other', () => {
  const split = { cutoff: '2026-11-10', before: 'f-sth', from: 'f-nth' };
  const r = buildMovements(damLoads, { fields: { 'SR Dam': split }, silos: { '20 Silo': 's-20' }, commodities: { Wheat: 'c-w' } });
  const where = Object.fromEntries(r.movements.map((m) => [refFromNotes(m.notes), m.froms[0].id]));
  assert.deepEqual(where, { M31: 'f-sth', M32: 'f-sth', M33: 'f-nth', M34: 'f-nth' });
});
check('a plain id still means the same paddock throughout', () => {
  assert.equal(targetOf('f-x', '2026-11-06'), 'f-x');
  assert.equal(targetOf({ cutoff: '2026-11-10', before: 'a', from: 'b' }, '2026-11-10'), 'b', 'the cutoff day itself is the later paddock');
  assert.equal(targetOf({ cutoff: '2026-11-10', before: 'a', from: 'b' }, '2026-11-09'), 'a');
});

console.log('');
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('ALL PASS');
