// Run with:
//   node tests/silolayers.test.mjs
//
// A silo is a stack of layers, each its own grade: the grain that was there, then
// each load. Running samples say what a stretch of it is, by tonnes from the bottom.
import assert from 'node:assert/strict';
import {
  gradeMix, dominantGrade, hasGrades, mixText, gradeColor, cleanBands, layersTotal, siloSvg, NO_GRADE,
} from '../docs/js/silolayers.js';
import { layersForStorage, predictPlan, applyBands } from '../docs/js/outload.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

const layer = (tons, grade) => ({ tons, spec: { grade } });
const load = (id, date, tons, grade, extra = {}) => ({
  id, date, ticketNo: id, tons, grade, ...extra,
  froms: [{ type: 'field', id: 'f', tons }], tos: [{ type: 'silo', id: 's1', tons }],
});
const out = (id, date, tons) => ({ id, date, ticketNo: id, tons, froms: [{ type: 'silo', id: 's1', tons }], tos: [{ type: 'sale', id: 'x', tons }] });
const shape = (layers) => layers.map((l) => [l.spec.grade, Math.round(l.tons * 10) / 10]);

console.log('\n=== grades in a silo ===');

check('the mix is by tonnes, most first', () => {
  const mix = gradeMix([layer(500, 'APH1'), layer(300, 'AUH2'), layer(200, 'APH1')]);
  assert.deepEqual(mix.map((g) => [g.grade, g.tons]), [['APH1', 700], ['AUH2', 300]]);
  assert.equal(Math.round(mix[0].pct * 100), 70);
});
check('spelling of a grade does not split it', () => {
  assert.equal(gradeMix([layer(1, 'aph1'), layer(1, ' APH1 ')]).length, 1);
});
check('grain with no grade is its own entry, and never the dominant grade', () => {
  const layers = [layer(900, ''), layer(100, 'APH1')];
  assert.equal(gradeMix(layers)[0].grade, NO_GRADE);
  assert.equal(dominantGrade(layers), 'APH1');
  assert.equal(hasGrades(layers), true);
  assert.equal(hasGrades([layer(5, '')]), false);
  assert.equal(dominantGrade([layer(5, '')]), '');
});
check('the mix reads as text, shortened when long, and one grade is just its name', () => {
  assert.equal(mixText(gradeMix([layer(60, 'APH1'), layer(40, 'AUH2')])), 'APH1 60% · AUH2 40%');
  assert.equal(mixText(gradeMix([layer(60, 'APH1')])), 'APH1');
  assert.equal(mixText(gradeMix([layer(40, 'A'), layer(30, 'B'), layer(20, 'C'), layer(10, 'D')]), 3), 'A 40% · B 30% · C 20% · +1 more');
  assert.equal(mixText([]), '');
});
check('a grade is always the same colour, and grain with no grade is grey', () => {
  assert.equal(gradeColor('APH1'), gradeColor(' aph1 '));
  assert.notEqual(gradeColor('APH1'), gradeColor(''));
  assert.equal(gradeColor(''), gradeColor(null));
});

console.log('\n=== samples, by tonnes from the bottom ===');

check('rows are cleaned: no tonnes means no band, grade trimmed, each measurement only if given', () => {
  const rows = cleanBands([
    { tons: '500', grade: ' APH1 ', proteinPct: '11.5', moisturePct: '10.8', screeningsPct: '1.2', testWeightKgHl: '79.5', fallingNumber: '410' },
    { tons: '', grade: 'X' }, { tons: 0 }, { tons: 200, grade: '', proteinPct: '' },
  ]);
  assert.deepEqual(rows, [{ tons: 500, grade: 'APH1', proteinPct: 11.5, moisturePct: 10.8, screeningsPct: 1.2, testWeightKgHl: 79.5, fallingNumber: 410 }, { tons: 200, grade: '' }]);
  assert.equal(layersTotal(rows), 700);
});
check('with no samples, nothing changes', () => {
  const { layers } = layersForStorage({ id: 's1', grade: 'APH1', openingStock: 800 }, []);
  assert.deepEqual(shape(layers), [['APH1', 800]]);
});
check('bands lay over the opening stock, bottom first, with every measurement', () => {
  const s = { id: 's1', openingStock: 1000, gradeBands: [
    { tons: 500, grade: 'APH1', proteinPct: 12, moisturePct: 11, screeningsPct: 1, testWeightKgHl: 80, fallingNumber: 400 },
    { tons: 500, grade: 'AUH2', proteinPct: 10 }] };
  const { layers } = layersForStorage(s, []);
  assert.deepEqual(shape(layers), [['APH1', 500], ['AUH2', 500]]);
  assert.equal(layers[0].spec.moisturePct, 11);
  assert.equal(layers[0].spec.screeningsPct, 1);
  assert.equal(layers[0].spec.testWeightKgHl, 80);
  assert.equal(layers[0].spec.fallingNumber, 400);
  assert.equal(layers[1].spec.moisturePct, null, 'a measurement not given is not made up');
});
check('a band covers grain from several loads, and a load that straddles two bands is split', () => {
  const s = { id: 's1', openingStock: 300, gradeBands: [{ tons: 500, grade: 'APH1', proteinPct: 12 }, { tons: 500, grade: 'AUH2', proteinPct: 10 }] };
  const { layers } = layersForStorage(s, [load(1, '2026-11-02', 400, 'H1'), load(2, '2026-11-03', 300, 'H1')]);
  // 300 opening + 400 + 300 = 1000 t: the first 500 t APH1, the next 500 t AUH2
  assert.deepEqual(shape(layers), [['APH1', 300], ['APH1', 200], ['AUH2', 200], ['AUH2', 300]]);
  assert.equal(layers[1].ticketNo, 1, 'the pieces remember which load they came from');
  assert.equal(layers[2].ticketNo, 1);
});
check('a stretch with tonnes but nothing said keeps the grain\'s own grade', () => {
  const s = { id: 's1', openingStock: 600, grade: 'H2', gradeBands: [{ tons: 200, grade: '' }, { tons: 400, grade: 'APH1' }] };
  assert.deepEqual(shape(layersForStorage(s, []).layers), [['H2', 200], ['APH1', 400]]);
});
check('grain beyond the last band keeps its own grade', () => {
  const s = { id: 's1', openingStock: 500, gradeBands: [{ tons: 500, grade: 'APH1' }] };
  const { layers } = layersForStorage(s, [load(1, '2026-11-02', 36, 'H1')]);
  assert.deepEqual(shape(layers), [['APH1', 500], ['H1', 36]]);
});
check('a band that runs past what is in the silo is simply ignored beyond it', () => {
  const s = { id: 's1', openingStock: 300, gradeBands: [{ tons: 200, grade: 'A' }, { tons: 800, grade: 'B' }] };
  assert.deepEqual(shape(layersForStorage(s, []).layers), [['A', 200], ['B', 100]]);
});
check('loads tipped in after the sampling date keep their own grade', () => {
  const s = { id: 's1', openingStock: 500, gradeBandsDate: '2026-11-05', gradeBands: [{ tons: 1000, grade: 'APH1' }] };
  const { layers } = layersForStorage(s, [load(1, '2026-11-03', 200, 'H1'), load(2, '2026-11-10', 100, 'H2')]);
  assert.deepEqual(shape(layers), [['APH1', 500], ['APH1', 200], ['H2', 100]]);
});
check('trucks take from the top: the lower bands stay exactly as they were', () => {
  const s = { id: 's1', openingStock: 1000, gradeBands: [{ tons: 500, grade: 'APH1' }, { tons: 500, grade: 'AUH2' }] };
  const { layers } = layersForStorage(s, [out(1, '2026-11-03', 700)]);
  assert.deepEqual(shape(layers), [['APH1', 300]], '700 t out: all of the AUH2 stretch and 200 t of the APH1');
});
check('the outload predictor runs through the stretches: the top stretch leaves first, with its measurements', () => {
  const s = { id: 's1', openingStock: 1000, gradeBands: [
    { tons: 500, grade: 'APH1', proteinPct: 12, moisturePct: 11 },
    { tons: 500, grade: 'AUH2', proteinPct: 10, moisturePct: 12 }] };
  const { layers } = layersForStorage(s, []);
  const plan = predictPlan(layers, 700, 350);
  assert.deepEqual(plan.trucks[0].grades.map((g) => g.grade), ['AUH2']);
  assert.equal(plan.trucks[0].specs.proteinPct.avg, 10);
  assert.equal(plan.trucks[0].specs.moisturePct.avg, 12);
  assert.deepEqual(plan.trucks[1].grades.map((g) => g.grade).sort(), ['APH1', 'AUH2']);
});
check('applyBands leaves the layers alone when there are no bands', () => {
  const layers = [{ tons: 5, source: 'opening', spec: { grade: 'X' } }];
  assert.equal(applyBands(layers, []), layers);
  assert.equal(applyBands(layers, undefined), layers);
});

console.log('\n=== the picture ===');

check('the picture has a band for each layer, and says what is in it', () => {
  const svg = siloSvg([{ tons: 500, spec: { grade: 'APH1' } }, { tons: 300, spec: { grade: 'AUH2' } }], 1000);
  assert.equal((svg.match(/<title>/g) || []).length, 2);
  assert.ok(svg.includes('APH1 500 t') && svg.includes('AUH2 300 t'));
  assert.ok(svg.startsWith('<svg'));
});
check('the grain stops short of the top when the silo is not full', () => {
  const bandHeights = (svg) => [...svg.matchAll(/<rect x="16" y="[\d.]+" width="\d+" height="([\d.]+)" fill="#/g)].map((m) => Number(m[1]));
  const half = bandHeights(siloSvg([{ tons: 500, spec: { grade: 'A' } }], 1000))[0];
  const full = bandHeights(siloSvg([{ tons: 1000, spec: { grade: 'A' } }], 1000))[0];
  assert.ok(Math.abs(half * 2 - full) < 0.5, `${half} vs ${full}`);
});
check('an empty silo draws without error', () => {
  assert.ok(siloSvg([], 500).includes('Empty silo'));
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
