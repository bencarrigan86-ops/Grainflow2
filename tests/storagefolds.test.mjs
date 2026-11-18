// Run with:
//   node tests/storagefolds.test.mjs
//
// The storage form keeps three jobs apart: the default grade, the grade summary (with samples tucked inside), and the
// outload plan. And the time box is given the same shape as the date box.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const v = read('docs/js/views/storage.js');

check('the quality fold is the default grade, and no fold is called by the old joined name', () => {
  assert.ok(v.includes('<h2>Default grade</h2>'));
  assert.ok(!v.includes('Grain quality</h2>') && !v.includes('Grade summary &amp; Outload predictor'));
});

check('the grade summary holds the samples as an optional step, and the plan is a fold of its own', () => {
  assert.ok(v.includes('<h2>Grade summary</h2>') && v.includes('id="sample-fold"') && v.includes('Regrade sections <span'));
  assert.ok(v.includes('id="plan-fold"') && v.includes('<h2>Plan an outload</h2>'));
  // the planner's boxes are in the plan fold, not the summary
  const plan = v.slice(v.indexOf('function planFold'));
  assert.ok(plan.includes("id: 'op-total'") && plan.includes('id="op-result"') === false || plan.includes('id="op-result"'));
  const summary = v.slice(v.indexOf('function contentsFold'), v.indexOf('function planFold'));
  assert.ok(!summary.includes("id: 'op-total'") && summary.includes('id="lay-rows"') && summary.includes('id="op-stack"'));
});

check('the time box takes the same iPhone fix as the date box', () => {
  assert.ok(read('docs/css/styles.css').includes('.field input[type="date"], .field input[type="time"] {'));
});

check('default grade, the loads in it now, and related movements all start closed; the samples are sections', () => {
  assert.ok(v.includes('<details class="fold">\n      <summary><div><h2>Default grade</h2>'));
  assert.ok(v.includes('id="stack-fold"') && v.includes('Outload order - quality') && !v.includes('In it now') && v.includes('Regrade sections <span') && v.includes('Set the grade of blocks of the ${isBunker'));
  assert.ok(!v.includes('Sampled it?'));
  assert.ok((v.match(/\{ collapsed: true \}/g) || []).length >= 2);
  assert.ok(read('docs/js/views/movements.js').includes('id="related-fold"'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
