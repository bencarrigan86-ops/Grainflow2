// Run with:
//   node tests/contractterms.test.mjs
//
// The confirmation of sale: the grade on a line of its own after the commodity, the quantity with its tolerance on the
// next line, and a premium or discount for each grade of a multigrade contract.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toleranceText, gradeTermsLines, gradeNamesText } from '../docs/js/contractterms.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const view = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'js', 'contractpdf.js'), 'utf8');

console.log('\n=== quantity and tolerance ===');
check('a tonnes cap and a percentage read together, the lesser binding', () => {
  assert.equal(toleranceText({ toleranceCapTons: 20, tolerancePct: 5 }, 't'), '+/- 20 t or 5%, whichever is the lesser');
});
check('either one alone', () => {
  assert.equal(toleranceText({ tolerancePct: 10 }, 't'), '+/- 10%');
  assert.equal(toleranceText({ toleranceCapTons: 20 }, 't'), '+/- 20 t');
  assert.equal(toleranceText({}, 't'), '');
});
check('the quantity is on one line and the tolerance on the next', () => {
  assert.ok(view.includes("['Quantity', [`${num(sale.tons, 0)} ${unit}`, toleranceText(sale, unit)]]"));
});

console.log('\n=== grade ===');
check('the commodity is a line of its own, the grade the next, then the quality', () => {
  const c = view.indexOf("['Commodity', commodity?.name || DASH]");
  const g = view.indexOf("[gradeLines.length ? 'Grades' : 'Grade'");
  const q = view.indexOf("['Quality'");
  assert.ok(c > 0 && g > c && q > g);
  assert.ok(!view.includes("[commodity?.name, sale.grade]"), 'no longer joined to the commodity');
});

console.log('\n=== multigrade ===');
const sale = { gradeOptions: [{ grade: 'APH1', adjust: 10 }, { grade: 'AGP1', adjust: 0 }, { grade: 'FEED', adjust: -25.5 }] };
check('each grade shows its premium as +$, its discount as -$, or the price as it stands', () => {
  assert.deepEqual(gradeTermsLines(sale, 'tonne'), [
    'APH1: +$10.00 per tonne',
    'AGP1: the price as above',
    'FEED: -$25.50 per tonne',
  ]);
});
check('the names of the grades, for the grade line', () => {
  assert.equal(gradeNamesText(sale), 'APH1, AGP1, FEED');
  assert.equal(gradeNamesText({ ...sale, grade: 'aph1' }), 'APH1, AGP1, FEED', 'its own grade is not repeated');
  assert.equal(gradeNamesText({ ...sale, grade: 'H2' }), 'H2, APH1, AGP1, FEED', 'but one that is not listed is kept');
});
check('a contract with no grades listed has nothing to show', () => {
  assert.deepEqual(gradeTermsLines({}, 'tonne'), []);
  assert.equal(gradeNamesText({}), '');
});
check('the confirmation shows the list, and says what a grade not listed is paid', () => {
  assert.ok(view.includes("['Premium / discount by grade', gradeLines.length ? [...gradeLines, 'A grade not listed is paid the price as above'] : '']"));
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
