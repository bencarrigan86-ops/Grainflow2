// Run with:
//   node tests/pwa.test.mjs
//
// Living on a phone: telling iPhone from Android, the install steps, what the device card says, asking the phone to
// keep the stored data, and that Account, the boot and the Help guide are wired to it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  platformOf, isStandalone, installSteps, installState, requestPersistence, storageStatus, storageText,
} from '../docs/js/pwa.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const checkAsync = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

console.log('\n=== which phone ===');
check('iPhone, iPad, Android and a computer are told apart', () => {
  assert.equal(platformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'), 'ios');
  assert.equal(platformOf('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'), 'android');
  assert.equal(platformOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36'), 'other');
  assert.equal(platformOf(), 'other');
});
check('an iPad that says it is a Mac is an iPhone-style device, a real Mac is not', () => {
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';
  assert.equal(platformOf(mac, 5), 'ios');
  assert.equal(platformOf(mac, 0), 'other');
});
check('installed is told by either the iOS flag or the display mode', () => {
  assert.equal(isStandalone({ navigator: { standalone: true } }), true);
  assert.equal(isStandalone({ navigator: {}, matchMedia: (q) => ({ matches: q.includes('standalone') }) }), true);
  assert.equal(isStandalone({ navigator: {}, matchMedia: () => ({ matches: false }) }), false);
  assert.equal(isStandalone({}), false);
  assert.equal(isStandalone({ matchMedia: () => { throw new Error('no'); } }), false);
});

console.log('\n=== the steps and the words ===');
check('each phone gets its own steps', () => {
  assert.ok(installSteps('ios').some((t) => /Safari/.test(t)) && installSteps('ios').some((t) => /Add to Home Screen/.test(t)));
  assert.ok(installSteps('android').some((t) => /Chrome/.test(t)) && installSteps('android').some((t) => /Install app/.test(t)));
  assert.ok(installSteps('other').length >= 2);
});
check('the card says installed, offers one tap when the browser can, or shows the steps', () => {
  assert.equal(installState({ standalone: true, platform: 'ios', canPrompt: false }).state, 'installed');
  assert.equal(installState({ standalone: false, platform: 'android', canPrompt: true }).state, 'prompt');
  assert.equal(installState({ standalone: false, platform: 'ios', canPrompt: false }).state, 'steps');
  assert.equal(installState({ standalone: true, canPrompt: true }).state, 'installed');
  assert.equal(installState().state, 'steps');
});
check('the storage line says protected, not protected, or unknown', () => {
  assert.match(storageText({ persisted: true }), /^Protected/);
  assert.match(storageText({ persisted: false }, false), /home screen/);
  assert.match(storageText({ persisted: false }, true), /Tap the button/);
  assert.match(storageText({ persisted: null }), /does not say/);
  assert.match(storageText(null), /does not say/);
});

console.log('\n=== keeping the saved data ===');
await checkAsync('it asks once, and only when the phone has not already promised', async () => {
  let asked = 0;
  const fresh = { persisted: async () => false, persist: async () => { asked += 1; return true; } };
  assert.equal(await requestPersistence(fresh), 'kept');
  assert.equal(asked, 1);
  const already = { persisted: async () => true, persist: async () => { asked += 1; return true; } };
  assert.equal(await requestPersistence(already), 'kept');
  assert.equal(asked, 1, 'no second ask');
});
await checkAsync('a refusal, a browser without it and a thrown error are all answered, never thrown', async () => {
  assert.equal(await requestPersistence({ persisted: async () => false, persist: async () => false }), 'refused');
  assert.equal(await requestPersistence({}), 'unsupported');
  assert.equal(await requestPersistence(undefined), 'unsupported');
  assert.equal(await requestPersistence({ persist: async () => { throw new Error('blocked'); } }), 'unsupported');
});
await checkAsync('the space used is rounded and a browser that will not say gives nulls', async () => {
  const st = await storageStatus({ persisted: async () => false, estimate: async () => ({ usage: 5.25 * 1048576, quota: 2048 * 1048576 }) });
  assert.deepEqual(st, { persisted: false, usageMb: 5.3, quotaMb: 2048 });
  assert.deepEqual(await storageStatus({}), { persisted: null, usageMb: null, quotaMb: null });
  assert.deepEqual(await storageStatus({ persisted: async () => { throw new Error('x'); }, estimate: async () => { throw new Error('x'); } }), { persisted: null, usageMb: null, quotaMb: null });
});

console.log('\n=== wired in ===');
check('Account has a This device card for every role, wired to the install and keep buttons', () => {
  const v = read('docs/js/views/account.js');
  assert.ok(v.includes('id="device-card"') && v.includes('paintDeviceCard(root)'));
  assert.ok(v.includes('id="dev-install"') && v.includes('id="dev-keep"') && v.includes('promptInstall()') && v.includes('requestPersistence()'));
  assert.ok(!/device-card[\s\S]{0,200}canManage/.test(v), 'not behind a role check');
});
check('the boot watches for the install offer and asks the phone to keep the data after sign-in', () => {
  const m = read('docs/js/main.js');
  assert.ok(m.includes('installWatch()'));
  assert.ok(m.indexOf('requestPersistence()') > m.indexOf('await db.init('));
});
check('Help has an install guide for every role with a picture', () => {
  const h = read('docs/js/helpcontent.js');
  assert.ok(/id: 'install'[^\n]*roles: ALL/.test(h));
  assert.ok(read('docs/js/helpvisuals.js').includes('install:'));
});

console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
process.exit(failures ? 1 : 0);
