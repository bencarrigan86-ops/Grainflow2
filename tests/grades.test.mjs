// Run with:
//   node tests/grades.test.mjs
//
// The grade lists behind the dropdowns, the standards on the reference page, and a farm's own grades.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STANDARDS, standardFor, cleanCustomGrades, gradesFor, gradeOptions, allGradeCodes, OTHER_GRADE,
} from '../docs/js/grades.js';
import { stateToRows, rowsToState } from '../docs/js/mapping.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

console.log('\n=== the published lists ===');

check('wheat has the ten GrainCorp grades, in order', () => {
  assert.deepEqual(gradesFor('Wheat').map((g) => g.code), ['APH1', 'APH2', 'H1', 'H2', 'AUH2', 'APW1', 'ASW1', 'AGP1', 'SFW1', 'FED1']);
});
check('barley, chickpeas, faba, sorghum and canola', () => {
  assert.deepEqual(gradesFor('Barley').map((g) => g.code), ['Malt 1', 'Malt 2', 'Malt 3', 'BAR1', 'BAR2']);
  assert.deepEqual(gradesFor('Chickpeas').map((g) => g.code), ['CHKP', 'CHK2', 'No.3']);
  assert.deepEqual(gradesFor('Faba beans').map((g) => g.code), ['Canning', 'FAB1', 'FAB2', 'No.3']);
  assert.deepEqual(gradesFor('Sorghum').map((g) => g.code), ['SOR', 'SOR2']);
  assert.deepEqual(gradesFor('Canola').map((g) => g.code), ['CAN', 'CANG']);
});
check('a commodity is found by what it is called, however it is spelt', () => {
  assert.equal(standardFor('Durum wheat').key, 'wheat');
  assert.equal(standardFor('  CANOLA ').key, 'canola');
  assert.equal(standardFor('Desi Chickpea').key, 'chickpeas');
  assert.equal(standardFor('Oats'), null);
  assert.equal(standardFor(undefined), null);
});

console.log('\n=== the standards tables ===');

check('every row has one value for each grade, so no column is short', () => {
  for (const s of STANDARDS) {
    for (const p of s.params) assert.equal(p.values.length, s.grades.length, `${s.title}: "${p.label}" has ${p.values.length} values for ${s.grades.length} grades`);
  }
});
check('some published figures, spot-checked against the source tables', () => {
  const val = (key, param, code) => {
    const s = STANDARDS.find((x) => x.key === key);
    return s.params.find((p) => p.label.startsWith(param)).values[s.grades.findIndex((g) => g.code === code)];
  };
  assert.equal(val('wheat', 'Protein', 'APH1'), '14.0');
  assert.equal(val('wheat', 'Falling', 'AUH2'), '250');
  assert.equal(val('wheat', 'Black point', 'FED1'), '50');
  assert.equal(val('barley', 'Protein', 'Malt 3'), '9.0–12.8');
  assert.equal(val('barley', 'Sprouted', 'BAR2'), '5%');
  assert.equal(val('chickpeas', 'Defective', 'CHK2'), '10');
  assert.equal(val('faba', 'Total defective', 'Canning'), '2');
  assert.equal(val('sorghum', 'Test weight', 'SOR2'), '62.0');
  assert.equal(val('canola', 'Moisture', 'CANG'), '8.0');
});
check('canola carries its oil and free fatty acid terms', () => {
  const notes = standardFor('Canola').notes.join(' ');
  assert.match(notes, /42\.0%/);
  assert.match(notes, /1\.5%/);
  assert.match(notes, /2\.5%/);
});

console.log('\n=== a farm\'s own grades ===');

check('they are trimmed, and blanks and repeats (ignoring case) are dropped', () => {
  assert.deepEqual(cleanCustomGrades([' House 1 ', 'house 1', '', null, 'Seed grade']), ['House 1', 'Seed grade']);
  assert.deepEqual(cleanCustomGrades(undefined), []);
});
check('they join the published ones, marked as the farm\'s own', () => {
  const list = gradesFor('Wheat', ['APW1 Plus']);
  assert.equal(list.length, 11);
  assert.deepEqual(list[10], { code: 'APW1 Plus', label: 'APW1 Plus (yours)', own: true });
});
check('one that repeats a published grade is not listed twice', () => {
  assert.equal(gradesFor('Wheat', ['apw1']).length, 10);
});
check('a commodity with no published grades has just the farm\'s own', () => {
  assert.deepEqual(gradesFor('Oats', ['Milling']).map((g) => g.code), ['Milling']);
  assert.deepEqual(gradesFor('Oats', []), []);
});

console.log('\n=== the dropdown ===');

check('"No grade" first and "Other" last, with the grades between', () => {
  const o = gradeOptions('Barley', [], '');
  assert.equal(o[0].value, '');
  assert.equal(o[0].label, 'No grade');
  assert.equal(o[o.length - 1].value, OTHER_GRADE);
  assert.equal(o.length, 5 + 2);
});
check('a grade already on a contract that is not on the list stays selectable', () => {
  const o = gradeOptions('Wheat', [], 'Old house grade');
  assert.ok(o.some((x) => x.value === 'Old house grade' && /not on the list/.test(x.label)));
});
check('a grade that is on the list is not added a second time', () => {
  assert.equal(gradeOptions('Wheat', [], 'aph1').filter((x) => /aph1/i.test(x.value)).length, 1);
});
check('with no commodity chosen there are no grades to offer, only the two choices', () => {
  assert.deepEqual(gradeOptions('', [], '').map((o) => o.value), ['', OTHER_GRADE]);
});
check('every grade across a farm\'s commodities, once each', () => {
  const codes = allGradeCodes([{ name: 'Wheat' }, { name: 'Barley', customGrades: ['House'] }, { name: 'Wheat' }]);
  assert.equal(codes.length, 10 + 5 + 1);
});

console.log('\n=== saving and loading ===');

const FARM = '11111111-1111-1111-1111-111111111111';
const state = (customGrades) => ({
  currentYear: '2026', nextMovementNo: 1, businessDetails: {},
  years: { 2026: { fields: [], storages: [], sales: [], movements: [], invoices: [], overheads: {},
    commodities: [{ id: '33333333-3333-3333-3333-333333333333', name: 'Wheat', ...(customGrades ? { customGrades } : {}) }] } },
});
check('a farm\'s own grades go to the server and come back', () => {
  const rows = stateToRows(state(['APW1 Plus', 'Seed grade']), FARM);
  assert.deepEqual(rows.commodities[0].custom_grades, ['APW1 Plus', 'Seed grade']);
  assert.deepEqual(rowsToState(rows).years[2026].commodities[0].customGrades, ['APW1 Plus', 'Seed grade']);
});
check('with none, no column is sent, so commodities still save before the database has the column', () => {
  assert.ok(!('custom_grades' in stateToRows(state(null), FARM).commodities[0]));
});
check('having had some and cleared them still sends an empty list, so the clearing reaches the server', () => {
  const s = state(null);
  s.years[2026].commodities[0].__hasCustomGrades = true;
  assert.deepEqual(stateToRows(s, FARM).commodities[0].custom_grades, []);
});

console.log('\n=== wired in ===');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'js');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');
check('the contract, load and storage forms use the dropdown, not a free text box', () => {
  assert.match(src('views/sales.js'), /gradeFieldHtml\(\{ id: 'grade'/);
  assert.match(src('views/movements.js'), /gradeFieldHtml\(\{ id: 'lq-grade'/);
  assert.match(src('views/storage.js'), /gradeFieldHtml\(\{ id: 'q-grade'/);
});
check('and they save what the dropdown says', () => {
  assert.match(src('views/sales.js'), /grade: gradeCtl\.read\(\)/);
  assert.match(src('views/movements.js'), /grade: gradeCtl\.read\(\)/);
  assert.match(src('views/storage.js'), /readQuality\(root, gradeCtl\)/);
});
check('Settings has both screens', () => {
  assert.match(src('views/settings.js'), /id="grade-standards"/);
  assert.match(src('views/settings.js'), /id="my-grades"/);
});
check('the database column is in the migration and the paste-in file', () => {
  const sql = readFileSync(join(ROOT, '..', '..', 'supabase', 'paste-into-sql-editor.sql'), 'utf8');
  assert.match(sql, /custom_grades jsonb/);
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
