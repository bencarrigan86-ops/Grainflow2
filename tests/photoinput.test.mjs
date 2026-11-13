// Run with:
//   node tests/photoinput.test.mjs
//
// A movement's photo can come from the camera or from the photo library.
//
// On a phone, `capture` on a file input goes straight to the camera and never offers the
// library, so the library needs an input of its own with no `capture`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'js');
const view = readFileSync(join(ROOT, 'views', 'movements.js'), 'utf8');
const img = readFileSync(join(ROOT, 'img.js'), 'utf8');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

const inputTag = (id) => view.match(new RegExp(`<input id="${id}"[^>]*>`))?.[0] || '';

check('there is a camera input, which opens the camera', () => {
  assert.match(inputTag('m-photo-file'), /capture="environment"/);
});
check('there is a library input, which has no capture so the phone offers its photos', () => {
  const tag = inputTag('m-photo-lib');
  assert.ok(tag, 'no library input');
  assert.ok(!/capture/.test(tag), 'a library input with capture would open the camera instead');
  assert.match(tag, /accept="image\/\*"/);
});
check('each has a button the person can see, and the inputs themselves are hidden', () => {
  assert.match(view, /id="m-photo-take"/);
  assert.match(view, /id="m-photo-pick"/);
  assert.match(inputTag('m-photo-file'), /\bhidden\b/);
  assert.match(inputTag('m-photo-lib'), /\bhidden\b/);
});
check('a library photo is stamped with when it was taken, a camera photo with now', () => {
  assert.match(view, /fromLibrary && file\.lastModified \? \{ takenAt: new Date\(file\.lastModified\) \} : \{\}/);
  assert.match(img, /takenAt instanceof Date/);
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
