#!/usr/bin/env node
//
// What the service worker will and will not answer from a cache.
//
//   node tests/sw.test.mjs
//
// The first service worker served version 74 to a phone for hours after 75
// shipped. Settings said 74, the code was 74, and there was no way to tell from
// the outside whether the deploy had failed or the device was lying. It was
// deleted rather than fixed. This file is the condition of it coming back.
//
// It reads docs/sw.js and pulls chooseStrategy() out of the actual source —
// not a copy of the rules restated here, which would agree with itself forever
// while the worker did something else. The same lesson as the fill state that
// the schema accepted and the app never wrote.
//
// Two failures matter more than the rest, and they are not equally bad:
//
//   stale code   the app is wrong until someone clears it. An afternoon.
//   stale data   the tonnages look right and are not. Nobody finds out.
//
// So the Supabase rule is checked hardest.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../docs/sw.js', import.meta.url), 'utf8');

// The worker is a classic script that registers listeners on `self` at load —
// so it is loaded here with a stubbed global, which also proves it parses and
// runs without a browser. A syntax error in the worker fails this immediately,
// which is worth having: nothing else in the suite ever loads that file, and a
// service worker that throws on install leaves a device with no worker at all
// and no message anywhere saying so.
const listeners = {};
const self_ = {
  location: { href: 'https://grainflow2.example.dev/sw.js?v=2026-09-01.84',
              origin: 'https://grainflow2.example.dev' },
  addEventListener: (name, fn) => { listeners[name] = fn; },
  skipWaiting: async () => {},
  clients: { claim: async () => {} },
};
const { chooseStrategy, CACHE_NAME, VENDOR_CACHE, SHELL } =
  new Function('self', 'caches', 'fetch', 'Request',
    `${src}\n;return { chooseStrategy, CACHE_NAME, VENDOR_CACHE, SHELL };`
  )(self_, { open: async () => {}, keys: async () => [] }, async () => {}, class {});

const ORIGIN = 'https://grainflow2.example.dev';
const how = (url, over = {}) => chooseStrategy({ url, origin: ORIGIN, ...over });

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); }
  catch (e) { failures += 1; console.log(`  FAIL  ${name}\n         ${e.message}`); }
};

console.log('\n=== the worker loads at all ===');

check('it parses, runs, and registers the four handlers', () => {
  for (const ev of ['install', 'activate', 'fetch', 'message']) {
    assert.ok(listeners[ev], `no ${ev} handler registered`);
  }
});

console.log('\n=== the farm\'s data is never cached ===');

check('nothing from Supabase is ever stored', () => {
  // The worst outcome this file exists to prevent. A cached paddock reads as
  // authoritative and is not, and unlike stale code nothing about the screen
  // looks wrong — so nobody goes looking.
  const urls = [
    'https://mvrlvytoplpwglgkxqpp.supabase.co/rest/v1/fields?select=*',
    'https://mvrlvytoplpwglgkxqpp.supabase.co/rest/v1/movements?farm_id=eq.x',
    'https://mvrlvytoplpwglgkxqpp.supabase.co/auth/v1/token?grant_type=password',
    'https://mvrlvytoplpwglgkxqpp.supabase.co/storage/v1/object/photos/a.jpg',
    'https://mvrlvytoplpwglgkxqpp.supabase.co/rest/v1/rpc/farm_members',
  ];
  for (const u of urls) assert.equal(how(u), 'network-only', u);
});

check('and not for any other Supabase project either', () => {
  assert.equal(how('https://someotherproject.supabase.co/rest/v1/fields'), 'network-only');
});

check('the Supabase rule is reached before anything that says yes to a cache', () => {
  // This assertion exists because deleting the Supabase line broke none of the
  // checks above: the generic cross-origin rule underneath caught those URLs
  // anyway, so the tests passed while the guard they were meant to protect had
  // gone. The guard is not redundant, it is *early*, and earliness is the thing
  // worth testing.
  //
  // The next plausible change here is caching photos for offline viewing, and
  // photos are served from *.supabase.co as well. On that day, whether a
  // paddock's tonnages get cached depends entirely on which branch runs first.
  // Comments stripped first. The obvious version of this check matched the word
  // "supabase.co" inside the comment above the guard, so deleting the guard
  // left the test passing — the third time in this codebase that a description
  // of a rule has been mistaken for the rule.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

  const body = code.slice(code.indexOf('function chooseStrategy'));
  const fn = body.slice(0, body.indexOf('\n}'));

  const guard = fn.search(/hostname[^\n]*supabase\.co/);
  assert.ok(guard > -1, 'the Supabase host check has been removed entirely');

  // Every branch that permits caching must sit below it.
  for (const m of fn.matchAll(/return '(?!network-only)([a-z-]+)'/g)) {
    assert.ok(m.index > guard,
      `"${m[1]}" can be returned before the Supabase check — a Supabase URL could reach it`);
  }
});

check('a write is never cached, wherever it goes', () => {
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE', 'HEAD']) {
    assert.equal(how(`${ORIGIN}/js/main.js?v=1`, { method }), 'network-only', method);
  }
});

console.log('\n=== the device can always find out there is a new build ===');

check('index.html goes to the network first, every time', () => {
  // The failure that deleted the last service worker. index.html carries no ?v=
  // of its own, so it is the only file that can tell a device a new build
  // exists. Serve it from cache and the device is marooned on what it has.
  assert.equal(how(`${ORIGIN}/`, { mode: 'navigate' }), 'network-first');
  assert.equal(how(`${ORIGIN}/index.html`), 'network-first');
  assert.equal(how(`${ORIGIN}/`), 'network-first');
});

check('so do the other pages', () => {
  assert.equal(how(`${ORIGIN}/state.html`), 'network-first');
  assert.equal(how(`${ORIGIN}/legacy-export.html`), 'network-first');
});

check('a navigation is network-first whatever it is spelled as', () => {
  assert.equal(how(`${ORIGIN}/js/main.js?v=84`, { mode: 'navigate' }), 'network-first');
});

check('the cache is named after the build, so a new one cannot read the old', () => {
  assert.equal(CACHE_NAME, 'grainflow-2026-09-01.84');
  assert.ok(!CACHE_NAME.includes('undefined'), 'the version did not come through the URL');
});

check('the shell it precaches is asked for at this build', () => {
  assert.ok(SHELL.includes('./index.html'), 'index.html is not precached — no offline start');
  assert.ok(SHELL.some((p) => p.includes('styles.css?v=2026-09-01.84')),
    'the stylesheet is precached at the wrong version');
});

console.log('\n=== app code ===');

check('a versioned URL is safe to serve from cache', () => {
  // ?v= names one specific build, so the bytes behind it cannot change.
  assert.equal(how(`${ORIGIN}/js/main.js?v=2026-09-01.84`), 'cache-first');
  assert.equal(how(`${ORIGIN}/js/views/settings.js?v=2026-09-01.84`), 'cache-first');
  assert.equal(how(`${ORIGIN}/css/styles.css?v=2026-09-01.84`), 'cache-first');
});

check('an unversioned asset is refreshed in the background', () => {
  assert.equal(how(`${ORIGIN}/icons/icon-192.png`), 'revalidate');
  assert.equal(how(`${ORIGIN}/manifest.webmanifest`), 'revalidate');
});

console.log('\n=== third-party module code ===');

check('esm.sh is cached, or the app cannot boot with no signal', () => {
  // supabase-js and idb are static imports. Without them main.js never runs,
  // and an offline-first app that will not open offline is a website.
  assert.equal(how('https://esm.sh/@supabase/supabase-js@2'), 'revalidate');
  assert.equal(how('https://esm.sh/idb@8'), 'revalidate');
  assert.equal(how('https://esm.sh/v135/@supabase/supabase-js@2.58.0/es2022/supabase-js.mjs'),
    'revalidate');
});

check('it is kept out of the versioned cache', () => {
  // Otherwise every release re-downloads a megabyte of vendor code and each
  // update is slower than the one before it.
  assert.notEqual(VENDOR_CACHE, CACHE_NAME);
  assert.ok(!VENDOR_CACHE.includes('2026-09-01.84'),
    'the vendor cache is versioned, so it is thrown away on every release');
});

check('nowhere else off-site is touched', () => {
  for (const u of ['https://cdn.example.com/x.js', 'https://google-analytics.com/collect',
    'https://esm.sh.evil.com/thing.js']) {
    assert.equal(how(u), 'network-only', u);
  }
});

console.log('\n=== junk does not get a strategy by accident ===');

check('a URL that will not parse is left alone', () => {
  for (const u of ['', 'not a url', '://', null, undefined]) {
    assert.equal(how(u), 'network-only', String(u));
  }
});

check('non-http schemes are left alone', () => {
  assert.equal(how('data:text/plain,hello'), 'network-only');
  assert.equal(how('blob:https://grainflow2.example.dev/abc'), 'network-only');
  assert.equal(how('chrome-extension://abc/script.js'), 'network-only');
});

check('every answer is one of the four strategies', () => {
  const known = ['network-only', 'network-first', 'cache-first', 'revalidate'];
  const urls = [`${ORIGIN}/`, `${ORIGIN}/js/a.js?v=1`, `${ORIGIN}/icons/i.png`,
    'https://esm.sh/idb@8', 'https://x.supabase.co/rest/v1/f', 'nonsense', ''];
  for (const u of urls) assert.ok(known.includes(how(u)), `${u} -> ${how(u)}`);
});

console.log('');
if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('ALL PASS');
