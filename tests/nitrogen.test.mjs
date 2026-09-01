#!/usr/bin/env node
//
// The nitrogen maths, both directions.
//
//   node tests/nitrogen.test.mjs
//
// Worth testing properly because it is the one calculation in this app that
// spends money. A requirement that is 2.17x too high across 320 hectares is an
// order for 240 tonnes of urea instead of 96, and nothing downstream would
// question it.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  nitrogenCalc, soilNUreaEquivalent, maxYieldFromUrea, fieldMaxYield,
  checkNPerTonne, ureaAppliedKgHaFor, UREA_N_PCT,
} from '../docs/js/derived.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); }
  catch (e) { failures += 1; console.log(`  FAIL  ${name}\n         ${e.message}`); }
};
const near = (a, b, tol = 0.05) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${b}, got ${a}`);

// Wheat: 44 kg N per tonne of grain, urea 46% N.
const WHEAT = { nPerTonne: 44 };

console.log('\n=== how much urea to hit a target ===');

check('4 t/ha off 38 kg soil N needs 300 kg urea', () => {
  const r = nitrogenCalc({ nPerTonne: 44, targetYieldTHa: 4, soilTestN: 38 });
  near(r.ureaForTargetYield, 382.6);   // 44 / 0.46 x 4
  near(r.soilUreaEquivalent, 82.6);    // 38 / 0.46
  near(r.additionalUreaRequired, 300.0);
});

check('no soil test means no credit', () => {
  const r = nitrogenCalc({ nPerTonne: 44, targetYieldTHa: 4, soilTestN: 0 });
  near(r.additionalUreaRequired, 382.6);
});

check('soil N beyond the target gives a negative requirement, not zero', () => {
  // Deliberately not clamped. A paddock carrying more N than the crop will use
  // is worth seeing as such, and hiding it behind a zero loses the fact.
  const r = nitrogenCalc({ nPerTonne: 44, targetYieldTHa: 1, soilTestN: 100 });
  assert.ok(r.additionalUreaRequired < 0, 'should read as surplus');
});

console.log('\n=== what the urea already applied will support ===');

check('300 kg urea on 38 kg soil N supports 4 t/ha', () => {
  const r = maxYieldFromUrea({ nPerTonne: 44, soilTestN: 38, ureaAppliedKgHa: 300 });
  near(r.nFromUrea, 138);          // 300 x 0.46
  near(r.nAvailableKgHa, 176);     // + 38
  near(r.maxYieldTHa, 4.0);
});

check('the two calculations are exact inverses', () => {
  // Whatever urea the first says is needed for a target, the second must give
  // that target back. If these ever disagree the app is telling a grower two
  // different things about the same paddock.
  for (const target of [1, 2.5, 4, 6.2, 9]) {
    for (const soil of [0, 12, 38, 90]) {
      const { additionalUreaRequired } =
        nitrogenCalc({ nPerTonne: 44, targetYieldTHa: target, soilTestN: soil });
      const { maxYieldTHa } =
        maxYieldFromUrea({ nPerTonne: 44, soilTestN: soil, ureaAppliedKgHa: additionalUreaRequired });
      near(maxYieldTHa, target, 0.001);
    }
  }
});

check('nothing applied still yields whatever the soil carries', () => {
  const r = maxYieldFromUrea({ nPerTonne: 44, soilTestN: 88, ureaAppliedKgHa: 0 });
  near(r.maxYieldTHa, 2.0);
});

check('no N figure for the commodity gives zero, not infinity', () => {
  const r = maxYieldFromUrea({ nPerTonne: 0, soilTestN: 38, ureaAppliedKgHa: 300 });
  assert.equal(r.maxYieldTHa, 0);
  assert.ok(Number.isFinite(r.maxYieldTHa));
});

console.log('\n=== a field, using what was actually spread ===');

check('dated applications are summed', () => {
  const f = { soilTestNKgHa: 38, ureaApplications: [
    { rateKgHa: 150 }, { rateKgHa: 100 }, { rateKgHa: 50 },
  ] };
  assert.equal(ureaAppliedKgHaFor(f), 300);
  near(fieldMaxYield(f, WHEAT).maxYieldTHa, 4.0);
});

check('the pre-logging total is used when there are no applications', () => {
  const f = { soilTestNKgHa: 38, ureaApplications: [], ureaAppliedKgHa: 300 };
  near(fieldMaxYield(f, WHEAT).maxYieldTHa, 4.0);
});

check('a field with no commodity does not throw', () => {
  const r = fieldMaxYield({ soilTestNKgHa: 38 }, undefined);
  assert.equal(r.maxYieldTHa, 0);
});

console.log('\n=== catching urea entered where nitrogen belongs ===');

check('44 passes', () => {
  assert.equal(checkNPerTonne(44).suspect, false);
});

check('95.65 is flagged, and recovers as 44', () => {
  const r = checkNPerTonne(95.65);
  assert.equal(r.suspect, true);
  near(r.asNitrogen, 44);
});

check('every commodity default passes', () => {
  // Wheat 44, Barley 34, Chickpeas 35, Faba 40, Canola 0, Sorghum 0.
  for (const v of [44, 34, 35, 40, 0]) {
    assert.equal(checkNPerTonne(v).suspect, false, `${v} should not be flagged`);
  }
});

check('the threshold sits above real pulses and below any urea figure', () => {
  // The lowest urea figure that could be entered by mistake is the smallest
  // sensible N rate divided by 0.46 — 20 / 0.46 = 43.5, which overlaps wheat.
  // So the guard cannot catch every case, and it is worth knowing which.
  assert.equal(checkNPerTonne(50).suspect, false, 'a high-protein pulse must pass');
  assert.equal(checkNPerTonne(61).suspect, true);
});

console.log('\n=== the urea nitrogen content is not hard-coded twice ===');

check('soil equivalence and the requirement use the same percentage', () => {
  assert.equal(UREA_N_PCT, 46);
  near(soilNUreaEquivalent(46), 100);
  const r = nitrogenCalc({ nPerTonne: 46, targetYieldTHa: 1, soilTestN: 0 });
  near(r.ureaForTargetYield, 100);
});

check('a different urea grade flows through both directions', () => {
  const r = nitrogenCalc({ nPerTonne: 44, targetYieldTHa: 4, soilTestN: 38, ureaNPct: 40 });
  const back = maxYieldFromUrea({
    nPerTonne: 44, soilTestN: 38, ureaAppliedKgHa: r.additionalUreaRequired, ureaNPct: 40,
  });
  near(back.maxYieldTHa, 4);
});

console.log('\n=== a typed application is not thrown away ===');

// Reported by Ben twice. You open a paddock, fill in the date, machine and
// rate under "Add application", press Save — the obvious thing to do, the
// button is right there — and the entry is gone. It only ever landed if you
// pressed "Add application" first.
//
// I said this was fixed once already and it was not: the function I described
// extracting was never in the file. So this is a test rather than another
// assurance. It reads production.js, because the fault is in the wiring
// between two click handlers and there is nothing pure to call.

const production = readFileSync(new URL('../docs/js/views/production.js', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

check('Save commits whatever is in the application form first', () => {
  const saveAt = production.indexOf("querySelector('#save')");
  assert.ok(saveAt > -1, 'the Save handler has moved or been renamed');

  const commitAt = production.indexOf('commitPendingApplication()', saveAt);
  const upsertAt = production.indexOf('db.upsertField(', saveAt);
  assert.ok(upsertAt > -1, 'Save no longer writes the field');
  assert.ok(commitAt > -1 && commitAt < upsertAt,
    'Save writes the field without first taking what is typed in the application form — '
    + 'a rate entered and not "Added" is discarded');
});

check('Add and Save share one implementation, so they cannot drift apart', () => {
  // Two copies of "build an application from the form" is how one of them ends
  // up handling the date field and the other does not.
  const defs = production.match(/const commitPendingApplication\s*=/g) || [];
  assert.equal(defs.length, 1, `commitPendingApplication is defined ${defs.length} times`);
  const uses = production.match(/commitPendingApplication\(\)/g) || [];
  assert.ok(uses.length >= 2,
    'only one caller — the Add button and Save should both go through it');
});

check('the rate is what decides there is something to save', () => {
  // An empty form must not push a phantom application every time somebody
  // opens a paddock and presses Save.
  const fn = production.slice(production.indexOf('const commitPendingApplication'));
  const body = fn.slice(0, fn.indexOf('};'));
  assert.match(body, /getNum\(root, 'ua-rate'\)/, 'it no longer reads the rate');
  assert.match(body, /if \(!rate\) return false;/, 'an empty form is no longer rejected');
});

console.log('');
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('ALL PASS');
