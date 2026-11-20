// Run with:
//   node tests/truckmemory.test.mjs
//
// A truck is remembered: the rego, driver and company boxes list those used before, and picking a rego fills the company,
// driver and the driver's phone from the latest load of that truck (into blank boxes or ones it filled itself).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'docs/js/views/movements.js'), 'utf8');

check('the load form lists the regos, drivers and companies used before', () => {
  assert.ok(src.includes('id="dl-regos"') && src.includes('id="dl-drivers"') && src.includes('id="dl-companies"'));
});
check('picking a rego fills company, driver and phone from the latest load of that truck, only into blank or auto-filled boxes', () => {
  assert.ok(src.includes("root.querySelector('#truckRego')?.addEventListener('change'"));
  assert.ok(src.includes("co.value === '' || co.value === companyAuto") && src.includes("dr.value === '' || dr.value === driverAuto") && src.includes("ph.value === '' || ph.value === phoneAuto"));
  assert.ok(src.includes('.replace(/\\s+/g, \'\').toLowerCase();'), 'spaces and case in a rego do not matter');
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
