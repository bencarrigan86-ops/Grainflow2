// Run with:
//   node tests/commoditycolor.test.mjs
//
// Each commodity has one colour, the same on Sales and Movement; the Movement list keeps its tickets banded.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { commodityColour, commodityClass } from '../docs/js/commoditycolor.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

check('the common crops each have their own colour', () => {
  assert.equal(commodityColour('Wheat'), 'amber');
  assert.equal(commodityColour('Cotton'), 'blue');
  assert.equal(commodityColour('Barley'), 'teal');
  assert.equal(commodityColour('Canola'), 'coral');
  assert.equal(commodityColour('Durum Wheat'), 'amber', 'a kind of wheat is wheat coloured');
  assert.equal(commodityColour('Cottonseed'), 'blue');
});

check('another commodity gets the same colour every time, and an empty name is neutral', () => {
  assert.equal(commodityColour('Faba beans'), commodityColour('faba beans'));
  assert.ok(commodityClass('Faba beans').startsWith('com-'));
  assert.equal(commodityColour(''), 'slate');
  assert.equal(commodityColour(undefined), 'slate');
});

check('every colour that can come back has a style', () => {
  const css = read('docs/css/styles.css');
  const seen = new Set(['Wheat', 'Cotton', 'Barley', 'Canola', 'Sorghum', 'Chickpeas', '', ...Array.from({ length: 200 }, (_, i) => `Crop ${i}`)].map(commodityClass));
  for (const cls of seen) assert.ok(css.includes(`.${cls} {`), cls);
});

check('Sales contracts under a commodity heading do not repeat it; the Paid list, with no headings, names it in its colour; Movement uses the same colours', () => {
  const s = read('docs/js/views/sales.js');
  assert.ok(s.includes('class="com-tag ${commodityClass(commodityName)}"') && s.includes('showCommodity && commodityName'));
  assert.ok(s.includes('saleRow(s, movements, commodities, i)).join') && s.includes('{ showCommodity: true }'), 'only the Paid list passes it');
  assert.ok(read('docs/js/views/movements.js').includes('class="mv-com ${commodityClass(commodity)}"'));
});

check('the Movement list keeps its tickets banded, in two alternating colours', () => {
  const m = read('docs/js/views/movements.js');
  assert.ok(m.includes('page.rows.map((m, i) =>') && m.includes('bandIndex: i'));
  assert.ok(m.includes("band ${ctx.bandIndex % 2 ? 'alt' : ''}"));
  assert.ok(read('docs/css/styles.css').includes('.list-item.band.alt'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
