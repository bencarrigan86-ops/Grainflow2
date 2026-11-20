// Run with:
//   node tests/tilefigures.test.mjs
//
// Position crop tiles: the figures shown are picked per device (kept in the browser, not on the farm), with two presets.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const pos = readFileSync(new URL('../docs/js/views/position.js', import.meta.url), 'utf8');

console.log('\n=== tile figures ===');
check('every figure the tile used to show can be ticked, in the same order', () => {
  const labels = ['Produced', 'Sold', 'Unsold', 'Area', 'Yield', 'Avg price', 'Margin', 'Margin %', 'Margin /ha'];
  let at = -1;
  for (const l of labels) {
    const i = pos.indexOf(`label: '${l}'`);
    assert.ok(i > at, `${l} is in the list, after the one before`);
    at = i;
  }
});
check('the tile draws only the ticked figures, and the choice is kept on this device', () => {
  assert.ok(pos.includes("TILE_FIELDS.filter((f) => keys.has(f.key))"));
  assert.ok(pos.includes("localStorage.setItem(TILE_KEY") && pos.includes("grainflow.positiontile"));
  assert.ok(!pos.includes("db.setBusinessDetails") || !/TILE_KEY[^\n]*db\./.test(pos), 'nothing about it goes to the farm');
});
check('there are Everything and Short presets, one figure always stays ticked, and the crop detail is untouched', () => {
  assert.ok(pos.includes("label: 'Everything'") && pos.includes("label: 'Short'"));
  assert.ok(pos.includes('at least one stays ticked'));
  assert.ok(pos.includes('<small>Yield</small>') === false, 'tile cells come from the list, not hand written');
  assert.ok(pos.includes('class="kv sm"><div class="l">Yield</div>'), 'the crop detail still has every figure');
});
check('a Figures button sits beside the tap-a-crop line', () => {
  assert.ok(pos.includes('id="tile-figures"') && pos.includes("openTileSheet("));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
