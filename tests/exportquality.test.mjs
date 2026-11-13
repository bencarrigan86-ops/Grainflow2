// Run with:
//   node tests/exportquality.test.mjs
//
// The grade and measurements in the CSV exports: load by load on movements, weighted averages on
// fields and storages, and a comments column on every export.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadQuality, averageQuality, qualityColumns, fieldQuality } from '../docs/js/exportquality.js';
import { layersForStorage } from '../docs/js/outload.js';
import { toCSV } from '../docs/js/csv.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

console.log('\n=== the columns ===');

check('grade, then each measurement, in a fixed order', () => {
  assert.deepEqual(qualityColumns(loadQuality).map((c) => c.label),
    ['Grade', 'Protein (%)', 'Moisture (%)', 'Screenings (%)', 'Test weight (kg/hL)', 'Falling number (s)', 'Oil (%)']);
});

console.log('\n=== movements: load by load ===');

check('a load carries its own grade and measurements', () => {
  const m = { grade: 'APH1', proteinPct: 11.8, moisturePct: 11.2, screeningsPct: 1.4, testWeightKgHl: 79.5, fallingNumber: 410 };
  const row = qualityColumns(loadQuality).map((c) => c.get(m));
  assert.deepEqual(row, ['APH1', 11.8, 11.2, 1.4, 79.5, 410, '']);
});
check('what is not recorded is blank, never zero', () => {
  const row = qualityColumns(loadQuality).map((c) => c.get({ grade: 'AUH2', proteinPct: 10.4 }));
  assert.deepEqual(row, ['AUH2', 10.4, '', '', '', '', '']);
  assert.deepEqual(qualityColumns(loadQuality).map((c) => c.get({})), ['', '', '', '', '', '', '']);
});
check('a canola load\'s oil is the last measurement', () => {
  const cols = qualityColumns(loadQuality);
  assert.equal(cols[cols.length - 1].label, 'Oil (%)');
  assert.equal(cols[cols.length - 1].get({ grade: 'CAN', oilPct: 43.5 }), 43.5);
});
check('a zero that was really recorded stays a zero', () => {
  assert.equal(qualityColumns(loadQuality)[3].get({ screeningsPct: 0 }), 0);
});

console.log('\n=== fields and storages: weighted average ===');

check('each measurement is averaged by tonnes (50 t at 270 and 40 t at 300 is 283)', () => {
  const q = averageQuality([
    { tons: 50, spec: { grade: 'APH1', fallingNumber: 270, proteinPct: 12 } },
    { tons: 40, spec: { grade: 'APH1', fallingNumber: 300, proteinPct: 11 } },
  ]);
  assert.equal(q.fallingNumber, 283);
  assert.equal(q.proteinPct, 11.6);
});
check('a load with a measurement missing is left out of that figure, not counted as zero', () => {
  const q = averageQuality([
    { tons: 50, spec: { grade: 'APH1', proteinPct: 12 } },
    { tons: 50, spec: { grade: 'APH1' } },
  ]);
  assert.equal(q.proteinPct, 12);
  assert.equal(q.moisturePct, null);
});
check('one grade is just that grade; several are the mix they are made of', () => {
  assert.equal(averageQuality([{ tons: 10, spec: { grade: 'APH1' } }, { tons: 5, spec: { grade: 'aph1' } }]).grade, 'APH1');
  const mix = averageQuality([{ tons: 60, spec: { grade: 'APH1' } }, { tons: 40, spec: { grade: 'AUH2' } }]);
  assert.equal(mix.grade, 'APH1 60% · AUH2 40%');
});
check('no grade anywhere is a blank grade, not "No grade"', () => {
  assert.equal(averageQuality([{ tons: 10, spec: { proteinPct: 11 } }]).grade, '');
  assert.equal(averageQuality([]).grade, '');
  assert.equal(averageQuality([]).proteinPct, null);
});
check('a field is the loads carted off it, weighted by what came from it', () => {
  const field = { id: 'f1' };
  const movements = [
    { froms: [{ type: 'field', id: 'f1', tons: 30 }], grade: 'APH1', proteinPct: 12 },
    { froms: [{ type: 'field', id: 'f1', tons: 10 }, { type: 'field', id: 'f2', tons: 99 }], grade: 'APH1', proteinPct: 10 },
    { froms: [{ type: 'field', id: 'f2', tons: 50 }], grade: 'AUH2', proteinPct: 8 },
  ];
  const q = fieldQuality(field, movements);
  assert.equal(q.grade, 'APH1');
  assert.equal(q.proteinPct, 11.5);        // (30 × 12 + 10 × 10) / 40
});
check('a field nothing has been carted off has blanks', () => {
  const cells = qualityColumns((f) => fieldQuality(f, [])).map((c) => c.get({ id: 'f1' }));
  assert.deepEqual(cells, ['', '', '', '', '', '', '']);
});
check('a silo is what is in it now: the opening stock and the loads, less what went out', () => {
  const silo = { id: 's1', openingStock: 100, grade: 'APH1', proteinPct: 11, fallingNumber: 400 };
  const movements = [
    { id: 'm1', date: '2026-11-01', tos: [{ type: 'silo', id: 's1', tons: 100 }], grade: 'AUH2', proteinPct: 9, fallingNumber: 300 },
    { id: 'm2', date: '2026-11-02', froms: [{ type: 'silo', id: 's1', tons: 100 }] },   // takes off the AUH2 on top
  ];
  const { layers } = layersForStorage(silo, movements);
  const q = averageQuality(layers.map((l) => ({ tons: l.tons, spec: l.spec })));
  assert.equal(q.grade, 'APH1');
  assert.equal(q.proteinPct, 11);
  assert.equal(q.fallingNumber, 400);
});

console.log('\n=== a comments column on every export ===');

const settingsSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'js', 'views', 'settings.js'), 'utf8');
const exportsIn = [...settingsSrc.matchAll(/exportRowsAsCSV\(`grainflow-(\w+)-[\s\S]*?\n  \]\);/g)].map((m) => ({ name: m[1], src: m[0] }));

check('all five exports were found', () => {
  assert.deepEqual(exportsIn.map((e) => e.name).sort(), ['fields', 'invoices', 'movements', 'sales', 'storage']);
});
check('each has a Comments column', () => {
  for (const e of exportsIn) assert.ok(e.src.includes("label: 'Comments'"), `${e.name} has no Comments column`);
});
check('movements, storage and fields have the grade columns', () => {
  for (const name of ['movements', 'storage', 'fields']) {
    assert.ok(exportsIn.find((e) => e.name === name).src.includes('qualityColumns('), `${name} has no grade columns`);
  }
});
check('a row comes out as CSV with the commas and quotes in a comment kept intact', () => {
  const csv = toCSV([{ notes: 'wet, "heavy" load' }], [{ label: 'Comments', get: (r) => r.notes }]);
  assert.equal(csv, 'Comments\r\n"wet, ""heavy"" load"');
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
