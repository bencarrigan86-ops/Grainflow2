// Run with:
//   node tests/optimiser.test.mjs
//
// The outload optimiser: which storages of a commodity can give a set tonnage at a set spec, in the order each one
// really empties, as a single storage or a blend. Delete this file with docs/js/optimiser.js and docs/js/views/optimiser.js
// to take the feature out.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sourcesFor, inOutOrder, drawSpecs, averages, breaches, truckPlan, tryBlend, optimise } from '../docs/js/optimiser.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${(e.stack || e.message).split('\n').slice(0, 3).join('\n        ')}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const spec = (grade, protein, moisture) => ({ grade, proteinPct: protein, moisturePct: moisture, screeningsPct: null, testWeightKgHl: null, fallingNumber: null, oilPct: null, ffaPct: null, retentionPct: null });
// a source whose grain is already in coming-out order
const src = (id, out) => ({ id, name: id, kind: 'silo', end: 'last', total: out.reduce((a, l) => a + l.tons, 0), out });
const round2 = (v) => Math.round(v * 100) / 100;

check('a silo gives up its top first and a bunker its chosen end', () => {
  const layers = [{ tons: 10, id: 'bottom' }, { tons: 20, id: 'top' }];
  assert.deepEqual(inOutOrder(layers, 'last').map((l) => l.id), ['top', 'bottom']);
  assert.deepEqual(inOutOrder(layers, 'first').map((l) => l.id), ['bottom', 'top']);
});

check('the first tonnes out are the top layer, not the average of the silo', () => {
  const out = [{ tons: 50, spec: spec('APH1', 13, 11) }, { tons: 100, spec: spec('ASW1', 9.5, 11) }];
  assert.equal(round2(averages(drawSpecs(out, 0, 36)).proteinPct), 13);
  // 14 t of the top layer, then 22 t of the next
  assert.equal(round2(averages(drawSpecs(out, 36, 72)).proteinPct), round2((14 * 13 + 22 * 9.5) / 36));
});

check('a measurement recorded on too little of the grain is not claimed', () => {
  const out = [{ tons: 100, spec: spec('APH1', 12, 11) }, { tons: 100, spec: spec('APH1', null, 11) }];
  assert.equal(averages(drawSpecs(out, 0, 200)).proteinPct, null);
  assert.equal(breaches(drawSpecs(out, 0, 200), { min: { proteinPct: 11 } }).length, 1);
});

check('grades outside the allowed list fail the stretch', () => {
  const out = [{ tons: 100, spec: spec('ASW1', 10, 11) }];
  assert.equal(breaches(drawSpecs(out, 0, 36), { grades: ['APH1', 'APW1'] }).length, 1);
  assert.equal(breaches(drawSpecs(out, 0, 36), { grades: ['ASW1'] }).length, 0);
});

check('the truck plan is whole trucks and a smaller last one, and long outloads are planned in bigger steps', () => {
  assert.deepEqual(truckPlan(100, 36).sizes.map((x) => Math.round(x)), [36, 36, 28]);
  assert.ok(truckPlan(100000, 36).sizes.length <= 60);
});

const hi = src('Silo A', [{ tons: 200, spec: spec('APH1', 13, 11) }]);
const lo = src('Silo B', [{ tons: 400, spec: spec('ASW1', 10, 11.5) }]);
const rules = { min: { proteinPct: 11.5 }, max: { moisturePct: 12.5 } };

check('a blend of two storages is worked out in proportion', () => {
  const r = tryBlend([{ source: hi, share: 0.5 }, { source: lo, share: 0.5 }], truckPlan(72, 36), rules);
  assert.equal(round2(r.avg.proteinPct), 11.5);
  assert.equal(r.parts[0].tons, 36);
  assert.equal(r.parts[1].tons, 36);
  assert.equal(r.meetsEveryTruck, true);
});

check('a blend that would take more than a storage holds is not offered', () => {
  const small = src('Small', [{ tons: 10, spec: spec('APH1', 13, 11) }]);
  assert.equal(tryBlend([{ source: small, share: 1 }], truckPlan(72, 36), rules), null);
});

check('one storage that meets the spec is offered alone, and a blend that is tighter is offered as well', () => {
  const res = optimise({ sources: [hi, lo], tons: 100, truck: 25, rules, mode: 'every-truck' });
  const sizes = res.options.map((o) => o.silos);
  assert.ok(sizes.includes(1), 'Silo A alone gives 13% protein');
  assert.ok(sizes.includes(2), 'a blend gets closer to 11.5%');
  const blend = res.options.find((o) => o.silos === 2);
  const alone = res.options.find((o) => o.silos === 1);
  assert.ok(blend.giveaway < alone.giveaway, 'the blend gives away less protein');
  assert.equal(alone.parts[0].name, 'Silo A');
});

check('when nothing meets the spec the closest are given, with what they miss', () => {
  const res = optimise({ sources: [hi, lo], tons: 100, truck: 25, rules: { min: { proteinPct: 15 } } });
  assert.equal(res.options.length, 0);
  assert.ok(res.closest.length > 0);
  assert.equal(res.closest[0].parts[0].name, 'Silo A');
  assert.ok(res.closest[0].worstTruckFails[0].got < 15);
});

check('every truck must meet the spec in the strict way: a good top over poor grain passes on average only while the top lasts', () => {
  const mixed = src('Mixed', [{ tons: 36, spec: spec('APH1', 13, 11) }, { tons: 400, spec: spec('ASW1', 9, 11) }]);
  const r = { min: { proteinPct: 12 } };
  const b = tryBlend([{ source: mixed, share: 1 }], truckPlan(72, 36), r);
  assert.equal(b.meetsEveryTruck, false, 'the second truck is 9% protein');
  assert.equal(b.meetsAverage, false, '11% on average is below 12');
  const first = tryBlend([{ source: mixed, share: 1 }], truckPlan(36, 36), r);
  assert.equal(first.meetsEveryTruck, true, 'one truck of the good top is fine');
});

check('it respects the order: the same grain, emptied from the other end, gives a different answer', () => {
  const layers = [{ tons: 100, spec: spec('ASW1', 9, 11) }, { tons: 100, spec: spec('APH1', 13, 11) }];   // bottom first
  const fromTop = src('S', inOutOrder(layers, 'last'));
  const fromBack = src('S', inOutOrder(layers, 'first'));
  const plan = truckPlan(36, 36);
  assert.equal(Math.round(tryBlend([{ source: fromTop, share: 1 }], plan, {}).avg.proteinPct), 13);
  assert.equal(Math.round(tryBlend([{ source: fromBack, share: 1 }], plan, {}).avg.proteinPct), 9);
});

check('storages are picked by commodity and left out with a reason: empty, or withholding after fumigation', () => {
  const today = '2026-11-17';
  const storages = [
    { id: 's1', name: 'Silo 1', kind: 'silo', commodityId: 'w', openingStock: 100, proteinPct: 12, grade: 'APH1' },
    { id: 's2', name: 'Silo 2', kind: 'silo', commodityId: 'w', openingStock: 100, fumigations: [{ id: 'f', date: '2026-11-10', days: 14 }] },
    { id: 's3', name: 'Silo 3', kind: 'silo', commodityId: 'w', openingStock: 0 },
    { id: 's4', name: 'Canola silo', kind: 'silo', commodityId: 'c', openingStock: 100 },
  ];
  const { sources, left } = sourcesFor({ storages, movements: [], commodityId: 'w', today });
  assert.deepEqual(sources.map((s) => s.id), ['s1']);
  assert.ok(left.find((l) => l.id === 's2').why.startsWith('Withholding after fumigation until 2026-11-24'));
  assert.equal(left.find((l) => l.id === 's3').why, 'Empty on the books');
  assert.ok(!left.some((l) => l.id === 's4'));
});

check('the feature is one module, one screen and one button, so it can be taken out', () => {
  const mod = read('docs/js/optimiser.js');
  assert.ok(!/from '\.\/(storage|supabase|sync)\.js/.test(mod), 'the maths never touches the database');
  assert.ok(read('docs/js/views/optimiser.js').includes('openOptimiserSheet'));
  assert.ok(read('docs/js/views/storage.js').includes('openOptimiserSheet'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
