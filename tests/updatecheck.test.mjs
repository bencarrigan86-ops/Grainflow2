// Run with:
//   node tests/updatecheck.test.mjs
//
// Telling somebody a newer build is out while the app is open: reading the build from the home page, newer-only, and a bar that
// offers the reload rather than doing it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSION } from '../docs/js/version.js';
const { newestBuild, currentBuild, isNewer, checkForNewBuild, checkNow, showUpdateBar, hideUpdateBar } = await import(`../docs/js/updatecheck.js?v=${APP_VERSION.split('.').pop()}`);

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const page = (n) => `<script type="module" src="js/main.js?v=${n}"></script>`;
const serves = (html, ok = true) => async () => ({ ok, text: async () => html });

await check('the build is read from the home page and from the version', () => {
  assert.equal(newestBuild(page(312)), 312);
  assert.equal(newestBuild('<html>nothing here</html>'), null);
  assert.equal(newestBuild(undefined), null);
  assert.equal(currentBuild('2026-11-16.309'), 309);
  assert.equal(currentBuild('dev'), null);
});

await check('only a newer build counts', () => {
  assert.equal(isNewer(309, 310), true);
  assert.equal(isNewer(309, 309), false);
  assert.equal(isNewer(309, 308), false, 'a rollback is not a reason to interrupt anybody');
  assert.equal(isNewer(null, 310), false);
  assert.equal(isNewer(309, null), false);
});

await check('a check answers the newer number, or null for same, older, a failed reply, or no signal', async () => {
  assert.equal(await checkForNewBuild('2026-11-16.309', serves(page(311))), 311);
  assert.equal(await checkForNewBuild('2026-11-16.309', serves(page(309))), null);
  assert.equal(await checkForNewBuild('2026-11-16.309', serves(page(308))), null);
  assert.equal(await checkForNewBuild('2026-11-16.309', serves(page(311), false)), null);
  assert.equal(await checkForNewBuild('2026-11-16.309', serves('<html>login wall</html>')), null);
  assert.equal(await checkForNewBuild('2026-11-16.309', async () => { throw new TypeError('Failed to fetch'); }), null);
});

await check('the check goes to the server, not to the saved copy', async () => {
  let seen;
  await checkForNewBuild('2026-11-16.309', async (url, opts) => { seen = { url, opts }; return { ok: true, text: async () => page(309) }; });
  assert.equal(seen.opts.cache, 'no-store');
  assert.equal(String(seen.url), './', 'the home page itself (no redirect hop), which the service worker never answers from its cache while online');
});

await check('asking by hand says newer (and shows the bar), current, or unknown when the server cannot be reached', async () => {
  const serves = (html, ok = true) => async () => ({ ok, text: async () => html });
  let shown = 0;
  const show = () => { shown++; };
  assert.deepEqual(await checkNow('2026-11-16.309', { show, fetchFn: serves(page(311)) }), { state: 'newer', build: 311 });
  assert.equal(shown, 1);
  assert.equal((await checkNow('2026-11-16.309', { show, fetchFn: serves(page(309)) })).state, 'current');
  assert.equal((await checkNow('2026-11-16.309', { show, fetchFn: async () => { throw new TypeError('Failed to fetch'); } })).state, 'unknown');
  assert.equal(shown, 1, 'nothing shown when there is nothing newer');
});

await check('it looks soon after opening, again at two and five minutes, every five while in front, and on every pick-up', () => {
  const src = read('docs/js/updatecheck.js');
  assert.ok(src.includes('followUpsMs = [15 * 1000, 2 * 60 * 1000, 5 * 60 * 1000]') && src.includes('everyMs = 5 * 60 * 1000') && src.includes('minGapMs = 60 * 1000'));
  for (const ev of ["'visibilitychange'", "'focus'", "'pageshow'", "'online'"]) assert.ok(src.includes(ev), ev);
  assert.ok(src.includes('missed = true'), 'a look that falls while the screen is off is made up when it is back');
  assert.ok(read('docs/js/views/settings.js').includes('id="check-update"'));
});

await check('the bar offers the reload and only reloads when told to; Later hides it', () => {
  // a minimal page: just enough of the document for the bar
  const kids = [];
  const mk = () => {
    const handlers = {};
    const el = { id: '', className: '', disabled: false, children: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, remove() { const i = kids.indexOf(this); if (i >= 0) kids.splice(i, 1); },
      addEventListener(t, f) { handlers[t] = f; }, click() { handlers.click?.(); },
      querySelector(sel) { return this.children[sel]; } };
    Object.defineProperty(el, 'innerHTML', { set(html) { this.children = { '#update-now': mk2(), '#update-later': mk2() }; this._html = html; }, get() { return this._html; } });
    return el;
  };
  const mk2 = () => { const h = {}; return { disabled: false, addEventListener(t, f) { h[t] = f; }, click() { h.click?.(); } }; };
  const doc = { createElement: mk, body: { appendChild: (el) => kids.push(el) }, getElementById: (id) => kids.find((k) => k.id === id) };
  let reloads = 0;
  const bar = showUpdateBar(doc, () => { reloads++; });
  assert.equal(kids.length, 1);
  assert.ok(bar.innerHTML.includes('A new version is ready'));
  assert.equal(showUpdateBar(doc, () => { reloads++; }), bar, 'one bar, however many times it is shown');
  assert.equal(reloads, 0, 'showing it never reloads');
  bar.querySelector('#update-later').click();
  assert.equal(kids.length, 0, 'Later takes it away');
  assert.equal(reloads, 0);
  const bar2 = showUpdateBar(doc, () => { reloads++; });
  bar2.querySelector('#update-now').click();
  assert.equal(reloads, 1);
  hideUpdateBar(doc);
  assert.equal(kids.length, 0);
});

await check('it is wired: main starts the check, and the bar has its place above the tabs', () => {
  const main = read('docs/js/main.js');
  assert.ok(main.includes("import { startUpdateCheck } from './updatecheck.js") && main.includes('startUpdateCheck(APP_VERSION)'));
  assert.ok(read('docs/css/styles.css').includes('.update-bar'));
});

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nall passed');
