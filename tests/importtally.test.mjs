// Run with:
//   node tests/importtally.test.mjs
//
// A load import never makes a tally storage (a bare count of bales or modules, with no measurements) out of grain: a shed or a store is a
// bunker / shed, measured in tonnes. And a storage an earlier import saved as a tally, counted in tonnes, can be made a silo or a bunker.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// the rule itself, read from the source (the module draws sheets, so it is not loaded here)
const src = read('docs/js/views/importloads.js');
const rule = src.match(/export const storageKindFor = \(name\) => \((.*)\);/);
const storageKindFor = rule ? new Function('name', `return (${rule[1]});`) : null;

check('a name with bunker, shed or store becomes a bunker / shed, anything else a silo, and nothing becomes a tally', () => {
  assert.ok(storageKindFor, 'the rule is there');
  for (const n of ['Bunker 1', 'Grain shed', 'Machinery Store', 'SHED 2']) assert.equal(storageKindFor(n), 'bunker', n);
  for (const n of ['Silo 12 (155t)', 'North', '']) assert.equal(storageKindFor(n), 'silo', n);
  assert.ok(!src.includes("'tally'"), 'the import never names a tally');
});

check('an existing tally counted in tonnes offers Silo and Bunker / shed so it can be measured; a bale or module tally, or in transit, does not', () => {
  const st = read('docs/js/views/storage.js');
  assert.ok(st.includes("const grainTally = !!existing && existing.kind === 'tally' && !isTransit(existing) && (existing.unitLabel || 't') === 't';"));
  assert.ok(st.includes('Choose Silo or Bunker / shed to measure it.'));
  assert.ok(st.includes("${!existing || existing.kind === 'tally' ? `<button data-kind=\"tally\""), 'and it can go back to a tally from the silo form');
});

check('the load import dropdowns list paddocks, silos and commodities in name order', () => {
  assert.ok(src.includes("localeCompare(String(b.name ?? ''), undefined, { numeric: true, sensitivity: 'base' })"), 'natural name order, A2 before A10');
  for (const list of ['fieldOpts', 'siloOpts', 'commodityOpts']) {
    assert.ok(new RegExp(`const ${list} = .*\\.sort\\(inOrder\\)`).test(src), `${list} is sorted`);
  }
  assert.ok(src.includes("farm: farmOf(f)") && src.includes("farm: farmOf(s)"), 'paddocks and silos carry their farm or site');
  assert.ok(src.includes("optionsByFarm(options[kind], cur,") && src.includes("optionsByFarm(fieldOpts, selected,"), 'both the main dropdowns and the split dropdowns group by farm');
  assert.ok(src.includes("'No farm / site'") && src.includes("(a === '') - (b === '')"), 'those with no farm come last');
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
