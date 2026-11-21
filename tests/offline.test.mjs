// Batch 2 of the review: opening with no signal after an update, a login that ran out, a save that failed, a screen that threw.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { APP_VERSION } from '../docs/js/version.js?v=501';
import { hasStoredLogin, decideOfflineSession } from '../docs/js/offlinestart.js?v=501';
import { buildPrecache, listFiles } from '../tools/make-precache.mjs';

const docs = new URL('../docs/', import.meta.url);
const read = (p) => readFileSync(new URL(p, docs), 'utf8');
let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('PASS', name); };
const BUILD = APP_VERSION.split('.').pop();

// ---- the file list the service worker downloads -------------------------------------------------------------------------------

t('precache.json lists every script, the stylesheet and the page at this build', () => {
  const have = JSON.parse(read('precache.json'));
  const want = buildPrecache(docs.pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/%20/g, ' '));
  assert.equal(have.build, BUILD, 'precache.json is for another build: run node tools/make-precache.mjs');
  assert.deepEqual(have.required, want.required, 'a file was added or removed under docs/: run node tools/make-precache.mjs');
  assert.deepEqual(have.optional, want.optional);
  assert.ok(have.required.includes('./index.html') && have.required.includes(`./css/styles.css?v=${BUILD}`));
});
t('every file the list names exists', () => {
  for (const p of JSON.parse(read('precache.json')).required) {
    const file = p === './' ? 'index.html' : p.split('?')[0].replace(/^\.\//, '');
    assert.ok(existsSync(new URL(file, docs)), `${p} is listed but missing`);
  }
});
t('index.html asks for the same stamp the list holds', () => {
  const html = read('index.html');
  for (const m of html.matchAll(/\?v=(\d+)/g)) assert.equal(m[1], BUILD, 'index.html has a different stamp from version.js');
  const list = JSON.parse(read('precache.json')).required;
  assert.ok(list.includes(`./css/styles.css?v=${BUILD}`) && list.includes(`./js/main.js?v=${BUILD}`));
});
t('every import in the app carries the build stamp, so each file is one copy at one address', () => {
  const bad = [];
  const dir = new URL('js/', docs).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/%20/g, ' ');
  for (const f of listFiles(dir)) {
    if (!f.endsWith('.js')) continue;
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/^\s*(?:import|export)\b[^'"\n]*from\s+'(\.{1,2}\/[^']+)'/gm)) {
      if (!/\?v=\d+$/.test(m[1])) bad.push(`${f.split(/[\\/]js[\\/]/)[1]}: ${m[1]}`);
      else assert.equal(m[1].split('?v=')[1], BUILD, `${f}: ${m[1]} is stamped for another build`);
    }
  }
  assert.deepEqual(bad, [], 'unstamped imports load a second copy of the file, from an address the offline cache does not hold');
});

// ---- the service worker ----------------------------------------------------------------------------------------------------

t('a page that cannot load says what to do, rather than staying blank', () => {
  const html = read('index.html');
  assert.ok(/<div id="app">[^<]*<div class="empty">[^<]*offline on a new version/.test(html));
});

// ---- opening with no signal on a login that ran out ------------------------------------------------------------------------------

const fakeStorage = (obj) => ({ get length() { return Object.keys(obj).length; }, key: (i) => Object.keys(obj)[i], getItem: (k) => obj[k] ?? null });
const login = (extra = {}) => ({
  'sb-abc-auth-token': JSON.stringify({ access_token: 'x', refresh_token: 'y' }),
  'grainflow.membership': JSON.stringify({ userId: 'u1', membership: { farmId: 'f1', role: 'owner' } }),
  ...extra,
});

t('a signed-in phone with its farm on it opens offline', () => {
  const s = decideOfflineSession({ online: false, storage: fakeStorage(login()), farmStamp: 'f1', copyOwner: 'u1' });
  assert.deepEqual(s, { user: { id: 'u1' }, offline: true });
});
t('an older copy with no owner stamp still opens for the person remembered', () => {
  assert.ok(decideOfflineSession({ online: false, storage: fakeStorage(login()), farmStamp: 'f1', copyOwner: null }));
});
t('with signal it never takes this path', () => {
  assert.equal(decideOfflineSession({ online: true, storage: fakeStorage(login()), farmStamp: 'f1' }), null);
  assert.equal(decideOfflineSession({ online: undefined, storage: fakeStorage(login()), farmStamp: 'f1' }), null);
});
t('a signed-out phone is not opened', () => {
  const only = { 'grainflow.membership': JSON.stringify({ userId: 'u1', membership: { farmId: 'f1' } }) };
  assert.equal(hasStoredLogin(fakeStorage(only)), false);
  assert.equal(decideOfflineSession({ online: false, storage: fakeStorage(only), farmStamp: 'f1' }), null);
});
t('a copy of another farm, or left by someone else, is not opened', () => {
  assert.equal(decideOfflineSession({ online: false, storage: fakeStorage(login()), farmStamp: 'other' }), null);
  assert.equal(decideOfflineSession({ online: false, storage: fakeStorage(login()), farmStamp: 'f1', copyOwner: 'u2' }), null);
  assert.equal(decideOfflineSession({ online: false, storage: fakeStorage(login()), farmStamp: null }), null);
});
t('nothing remembered, or unreadable, means the sign-in screen', () => {
  const noMember = { 'sb-abc-auth-token': JSON.stringify({ refresh_token: 'y' }) };
  assert.equal(decideOfflineSession({ online: false, storage: fakeStorage(noMember), farmStamp: 'f1' }), null);
  assert.equal(decideOfflineSession({ online: false, storage: fakeStorage({ ...login(), 'grainflow.membership': '{oops' }), farmStamp: 'f1' }), null);
});
t('boot uses it only when offline, and asks the library again when signal returns', () => {
  const m = read('js/main.js');
  assert.ok(m.includes('navigator.onLine === false ? await offlineSession() : null'));
  assert.ok(/offlineOpen\) return;[\s\S]{0,200}getSession\(\)/.test(m));
});

// ---- the app coming back to the front, and screens ---------------------------------------------------------------------------------

t('a repeat SIGNED_IN for the person already open does not start the app over', () => {
  const m = read('js/main.js');
  assert.ok(m.includes('if (id && bootedFor === id) return;'));
  assert.ok(m.includes('bootedFor = null;'));
});
t('opening a screen drops the repaint listeners the last one left', () => {
  const m = read('js/main.js');
  const i = m.indexOf('function renderActiveView()');
  assert.ok(m.indexOf('db.leaveScreen()', i) > i);
  const s = read('js/storage.js');
  assert.ok(/leaveScreen\(\) \{\s*epoch \+= 1;/.test(s) && s.includes('listenerEpoch.set(fn, epoch)'));
});
t('a screen that throws shows a message and a way out, not a blank page', () => {
  const m = read('js/main.js');
  const i = m.indexOf('function renderActiveView()');
  assert.ok(/try \{ route\.render\(app\); \}\s*catch \(e\) \{[^}]*showScreenFault/.test(m.slice(i, i + 600)));
  assert.ok(m.includes("addEventListener('grainflow:view-failed'"));
  const s = read('js/storage.js');
  assert.ok(!s.includes("console.error('A view failed to re-render"), 'a repaint failure is only logged');
  assert.ok(s.includes('grainflow:view-failed'));
});

// ---- a save to the phone that fails ------------------------------------------------------------------------------------------------

t('a failed save to the phone is shown, can be retried, and clears when it works', () => {
  const m = read('js/main.js');
  assert.ok(m.includes("addEventListener('grainflow:save-failed', () => setSaveBanner(true))"));
  assert.ok(m.includes("addEventListener('grainflow:save-ok'"));
  assert.ok(m.includes('db.retrySave()'));
  const s = read('js/storage.js');
  assert.ok(s.includes('saveFailed = true;') && s.includes('async retrySave()'));
});
t('a failed open of the phone\'s storage is not remembered for ever', () => {
  const l = read('js/local.js');
  assert.ok(/\.catch\(\(e\) => \{[^}]*dbPromise = null;[^}]*throw e;/.test(l));
});

// ---- sending, offline ---------------------------------------------------------------------------------------------------------------

t('there is one listener that sends what is owed on reconnect, however many times the farm is started', () => {
  const s = read('js/storage.js');
  assert.ok(s.includes('stopReconnect?.();') && s.includes('stopReconnect = pushOnReconnect('));
});
t('with no signal a push does not try', () => {
  assert.ok(read('js/sync.js').includes('navigator.onLine === false) return { skipped: true, offline: true }'));
});

t('a bar across the top (test copy, support view, a save problem) does not hide the season pill and the gear', () => {
  const css = read('css/styles.css');
  const rule = (sel) => { const i = css.indexOf(`${sel} {`); return css.slice(i, css.indexOf('}', i)); };
  const pill = rule('.year-pill').includes('var(--banner-h, 0px)');
  const gear = rule('.settings-btn').includes('var(--banner-h, 0px)');
  assert.ok(pill && gear, 'the pill and gear do not move down by the bar height');
  const m = read('js/main.js');
  assert.ok(m.includes("t.id = 'test-banner'") && m.includes("['test-banner', 'support-banner', 'save-banner']"));
  assert.ok((m.match(/updateBannerSpace()/g) || []).length >= 4);
  // On a phone the app draws under the clock: the top bar reaches up behind it and its text starts below, so it is readable.
  assert.ok(/body > #test-banner:first-child[\s\S]{0,120}padding-top: calc\(var\(--safe-top\) \+ 6px\) !important/.test(css), 'the top bar text sits under the phone clock');
  assert.ok(css.includes('html.has-banner #app { padding-top: 0; }') && css.includes("classList.toggle('has-banner'") === false);
  assert.ok(m.includes("classList.toggle('has-banner', h > 0)"));
});

console.log(`${n} passed`);
